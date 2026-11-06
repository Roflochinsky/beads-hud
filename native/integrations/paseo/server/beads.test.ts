import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type {
  AgentToolContext, AgentToolResult, PluginHandlerContext, PluginHookContext,
  PluginServerContext, PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import { FetchWorkspacesRequestMessageSchema } from "@getpaseo/protocol/messages";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import contribute from "../index.server.js";
import { snapshotSchema } from "../shared/rpc.js";
import type { BeadsRequest } from "../shared/rpc.js";
import { handleBeads } from "./beads.js";

type SessionHook = (
  input: { request: PluginSessionOpenRequest }, context: PluginHookContext,
) => PluginSessionOpenRequest | void | Promise<PluginSessionOpenRequest | void>;
type RpcHandler = (input: BeadsRequest, context: PluginHandlerContext) => unknown;

async function openAgentTool(host: unknown, workspaceId: string, cwd: string) {
  let hook!: SessionHook;
  let rpc!: RpcHandler;
  const server = {
    handle(_contract: unknown, handler: RpcHandler) { rpc = handler; },
    before(event: string, handler: SessionHook) {
      assert.equal(event, "agent.session_open");
      hook = handler;
      return () => {};
    },
  } as unknown as PluginServerContext;
  contribute(server);
  const paseo = host as PluginHookContext["paseo"];
  const signal = new AbortController().signal;
  const request: PluginSessionOpenRequest = {
    agentId: "agent", workspaceId, provider: "fixture", cwd, reason: "create",
    purpose: "interactive", title: null, labels: {}, tools: [], env: {}, mcpServers: {},
  };
  await hook({ request }, { paseo, signal });
  assert.equal(request.tools.length, 1);
  const tool = request.tools[0]!;
  const context: AgentToolContext = {
    paseo, signal,
    agent: { id: "agent", workspaceId, parentAgentId: null, provider: "fixture", cwd, title: null },
  };
  return { rpc, tool, context };
}

// Paseo 0.14.0's plugin tool bridge turns text into an MCP content block and
// passes structuredContent through; validate that actual wire shape.
function mcpResult(result: AgentToolResult) {
  return CallToolResultSchema.parse({
    content: result.text === undefined ? [] : [{ type: "text", text: result.text }],
    ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  });
}

test("agent comments and mutation results are valid MCP results with stable text", async () => {
  const root = await mkdtemp(join(tmpdir(), "beads-paseo-tool-"));
  const previousPath = process.env.PATH;
  try {
    await mkdir(join(root, ".beads"));
    await writeFile(join(root, "bd"), `#!${process.execPath}
const args = process.argv.slice(2);
const command = args.find((arg) => ["list", "comments", "comment", "create", "update"].includes(arg));
if (command === "list") process.stdout.write(JSON.stringify([{ id: "fixture-1" }]));
else if (command === "comments") process.stdout.write(JSON.stringify([{ id: 7, text: "Useful note" }]));
else if (command === "comment") {} // A successful native mutation may produce no output.
else if (command === "create") process.stdout.write(JSON.stringify({ id: "fixture-2" }));
else if (command === "update") process.stdout.write("Updated fixture");
else process.exit(90);
`, { mode: 0o755 });
    process.env.PATH = `${root}${delimiter}${previousPath ?? ""}`;
    const host = { workspaces: { async list() {
      return { entries: [{ id: "workspace", name: "Fixture", projectRootPath: root }], pageInfo: { hasMore: false, nextCursor: null } };
    } } };
    const { tool, context } = await openAgentTool(host, "workspace", root);

    const comments = await tool.execute({ method: "comments", input: { id: "fixture-1" } }, context);
    const parsedComments = mcpResult(comments);
    assert.deepEqual(parsedComments.structuredContent, { result: [{ id: 7, text: "Useful note" }] });
    assert.deepEqual(parsedComments.content, [{ type: "text", text: '[{"id":7,"text":"Useful note"}]' }]);

    const emptyMutation = await tool.execute({ method: "comment", input: { id: "fixture-1", text: "A note" } }, context);
    const parsedEmpty = mcpResult(emptyMutation);
    assert.deepEqual(parsedEmpty.structuredContent, { result: null });
    assert.deepEqual(parsedEmpty.content, [{ type: "text", text: "null" }]);

    const textMutation = await tool.execute({ method: "update", input: { id: "fixture-1", title: "Changed" } }, context);
    const parsedText = mcpResult(textMutation);
    assert.deepEqual(parsedText.structuredContent, { result: "Updated fixture" });
    assert.deepEqual(parsedText.content, [{ type: "text", text: '"Updated fixture"' }]);

    const objectMutation = await tool.execute({ method: "create", input: { title: "Created" } }, context);
    const parsedObject = mcpResult(objectMutation);
    assert.deepEqual(parsedObject.structuredContent, { id: "fixture-2" });
    assert.deepEqual(parsedObject.content, [{ type: "text", text: '{"id":"fixture-2"}' }]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("Beads resolves all host workspace pages without accepting caller paths", async () => {
  const host = {
    workspaces: {
      async list(options?: { page?: { cursor?: string } }) {
        return options?.page?.cursor === "page-two"
          ? { entries: [{ id: "ws-two", name: "Second", projectRootPath: "/projects/two", workspaceDirectory: "/worktrees/two" }], pageInfo: { hasMore: false, nextCursor: null } }
          : { entries: [{ id: "ws-one", name: "First", projectRootPath: "/projects/one" }], pageInfo: { hasMore: true, nextCursor: "page-two" } };
      },
    },
  };
  assert.deepEqual(await handleBeads({ method: "projects" }, host), [
    { id: "ws-one", name: "First", path: "/projects/one" },
    { id: "ws-two", name: "Second", path: "/worktrees/two" },
  ]);
  await assert.rejects(() => handleBeads({ method: "snapshot", project: "/outside" }, host), /workspace/i);
});

test("background workspace panels and agent tools use host paths across workspace pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "beads-paseo-background-"));
  const previousPath = process.env.PATH;
  try {
    const firstWorktree = join(root, "first-worktree");
    const lastWorktree = join(root, "last-worktree");
    await mkdir(join(firstWorktree, ".beads"), { recursive: true });
    await mkdir(join(lastWorktree, ".beads"), { recursive: true });
    await writeFile(join(root, "bd"), `#!${process.execPath}
const args = process.argv.slice(2);
const command = args.find((arg) => ["list", "dep", "ready", "blocked", "comments"].includes(arg));
const first = process.cwd().endsWith("first-worktree");
if (command === "list") process.stdout.write(JSON.stringify([{
  id: "bg-1", title: first ? "First background issue" : "Last background issue", status: "open", priority: 2,
  issue_type: "task", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T00:00:00Z"
}]));
else if (command === "comments") process.stdout.write(JSON.stringify([{ id: 9, text: first ? "First background note" : "Last background note" }]));
else if (["dep", "ready", "blocked"].includes(command)) process.stdout.write("[]");
else process.exit(90);
`, { mode: 0o755 });
    process.env.PATH = `${root}${delimiter}${previousPath ?? ""}`;
    const ordinary = Array.from({ length: 101 }, (_, index) => ({
      id: `ordinary-${index}`, name: `Ordinary ${index}`, projectRootPath: `/projects/${index}`,
      background: false,
    }));
    const backgroundFirst = { id: "background-first", name: "Background first", projectRootPath: firstWorktree, background: true };
    const backgroundLast = {
      id: "background-last", name: "Background last", projectRootPath: join(root, "not-the-worktree"),
      workspaceDirectory: lastWorktree, background: true,
    };
    const all = [ordinary[0]!, backgroundFirst, ...ordinary.slice(1, 100), backgroundLast, ordinary[100]!];
    const host = { workspaces: {
      async list(options?: { filter?: { includeBackground?: boolean }; page?: { limit: number; cursor?: string } }) {
        const query = FetchWorkspacesRequestMessageSchema.parse({
          type: "fetch_workspaces_request", requestId: "fixture", ...options,
        });
        const visible = all.filter((workspace) => !workspace.background || query.filter?.includeBackground === true);
        const start = query.page?.cursor ? Number(query.page.cursor) : 0;
        const end = Math.min(start + (query.page?.limit ?? 100), visible.length);
        return {
          entries: visible.slice(start, end),
          pageInfo: { hasMore: end < visible.length, nextCursor: end < visible.length ? String(end) : null },
        };
      },
    } };
    const { rpc, tool, context } = await openAgentTool(host, "background-first", lastWorktree);
    const rpcContext = { paseo: context.paseo };
    const projects = await rpc({ method: "projects" }, rpcContext) as { id: string; name: string; path: string }[];
    assert.equal(projects.length, 103);
    assert.deepEqual(projects.filter((project) => project.id.startsWith("ordinary-")).map((project) => project.id), ordinary.map((workspace) => workspace.id));
    assert.deepEqual(projects.find((project) => project.id === "background-last"), {
      id: "background-last", name: "Background last", path: lastWorktree,
    });

    const panel = snapshotSchema.parse(await rpc({ method: "snapshot", project: "background-last" }, rpcContext));
    assert.deepEqual(panel.project, { id: "background-last", name: "Background last", path: lastWorktree });
    assert.equal(panel.issues[0]?.title, "Last background issue");
    const comments = await tool.execute({ method: "comments", input: { id: "bg-1" } }, context);
    assert.deepEqual(mcpResult(comments).structuredContent, { result: [{ id: 9, text: "First background note" }] });

    assert.equal(tool.input.safeParse({ method: "comments", project: "background-last", input: { id: "bg-1" } }).success, false);
    await assert.rejects(async () => rpc({ method: "snapshot", project: lastWorktree }, rpcContext), /workspace/i);
    await assert.rejects(async () => rpc({ method: "snapshot", project: "unknown" }, rpcContext), /workspace/i);
    await assert.rejects(
      async () => tool.execute({ method: "comments", input: { id: "bg-1" } }, {
        ...context, agent: { ...context.agent, workspaceId: "unknown" },
      }),
      /workspace/i,
    );
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported commands and host failures are visible to the consumer", async () => {
  const host = { workspaces: { async list(): Promise<never> { throw new Error("Host offline"); } } };
  await assert.rejects(() => handleBeads({ method: "projects" }, host), /Host offline/);
  await assert.rejects(() => handleBeads(
    { method: "exec" } as unknown as Parameters<typeof handleBeads>[0], host,
  ), /Invalid option/);
});

test("a consumer creates, claims, closes and reopens a real isolated Beads issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "beads-paseo-test-"));
  const savedEnvironment = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (/^(BEADS_|BD_|DOLT_)/.test(key)) delete process.env[key];
    }
    process.env.HOME = join(root, "home");
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.BEADS_ACTOR = "paseo-smoke";
    await mkdir(process.env.HOME, { recursive: true });
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });
    const path = join(root, "workspace");
    await mkdir(path);
    execFileSync("git", ["init", "--quiet", path]);
    execFileSync("git", ["config", "--local", "user.name", "Paseo smoke"], { cwd: path });
    execFileSync("git", ["config", "--local", "user.email", "paseo-smoke@example.invalid"], { cwd: path });
    execFileSync("bd", ["init", "--prefix=smoke", "--non-interactive", "--skip-agents", "--skip-hooks"], { cwd: path, timeout: 60_000 });
    const host = { workspaces: { async list() {
      return { entries: [{ id: "workspace", name: "Fixture", projectRootPath: path }], pageInfo: { hasMore: false, nextCursor: null } };
    } } };
    const request = (method: Parameters<typeof handleBeads>[0]["method"], input?: Record<string, unknown>) =>
      handleBeads({ method, project: "workspace", ...(input ? { input } : {}) }, host);
    await request("create", { title: "Paseo fixture", type: "task", priority: 2 });
    let snapshot = snapshotSchema.parse(await request("snapshot"));
    assert.equal(snapshot.issues.length, 1);
    const issue = snapshot.issues[0]!;
    assert.equal(issue.title, "Paseo fixture");
    assert.ok(snapshot.readyIds.includes(issue.id));
    const { tool, context } = await openAgentTool(host, "workspace", path);
    const comments = await tool.execute({ method: "comments", input: { id: issue.id } }, context);
    const parsedComments = mcpResult(comments);
    assert.deepEqual(parsedComments.structuredContent, { result: [] });
    assert.deepEqual(parsedComments.content, [{ type: "text", text: "[]" }]);
    await request("claim", { id: issue.id });
    snapshot = snapshotSchema.parse(await request("snapshot"));
    assert.equal(snapshot.issues[0]?.status, "in_progress");
    await request("close", { id: issue.id, reason: "Verified fixture" });
    snapshot = snapshotSchema.parse(await request("snapshot"));
    assert.equal(snapshot.issues[0]?.status, "closed");
    await request("reopen", { id: issue.id });
    snapshot = snapshotSchema.parse(await request("snapshot"));
    assert.equal(snapshot.issues[0]?.status, "open");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
    Object.assign(process.env, savedEnvironment);
    await rm(root, { recursive: true, force: true });
  }
});
