import { execFile, type ExecFileException } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { Issue, Project, RpcRequest, Snapshot } from '../shared.js';

// bd 1.3.2: keep CLI policy authoritative (actor, claims, leases, readiness).
// A request has one 30s deadline and a 16 MiB aggregate stdout/stderr budget.
// Exceeding either is an error, never a successful but truncated snapshot.
const REQUEST_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
const TEXT_LIMIT = 64 * 1024;
const DEPENDENCY_BATCH_SIZE = 100;
const executeFile = promisify(execFile);
const processQueues = new Map<string, Promise<void>>();
const LIST_ALL = [
  'list', '--all', '--limit=0', '--flat', '--include-ephemeral',
  '--include-gates', '--include-infra', '--include-templates',
];
// Only ambient routing selectors are removed. Passwords, credential helpers,
// TLS settings, actor and replica identity remain available to project config.
const ROUTING_ENV = [
  'BEADS_DB', 'BD_DB', 'BEADS_DATABASE', 'BD_DATABASE', 'BEADS_GLOBAL', 'BD_GLOBAL',
  'BEADS_DOLT_SERVER_DATABASE', 'BEADS_DOLT_SERVER_MODE', 'BEADS_DOLT_SERVER_HOST',
  'BEADS_DOLT_SERVER_PORT', 'BEADS_DOLT_PORT', 'BEADS_DOLT_SERVER_SOCKET',
  'BEADS_DOLT_DATA_DIR', 'BEADS_DOLT_SHARED_SERVER', 'BEADS_SHARED_SERVER_DIR',
  'BEADS_PROXIED_SERVER_ROOT_PATH', 'BEADS_PROXIED_SERVER_CONFIG', 'BEADS_CENTRAL_CONFIG',
  'BD_DOLT_HOST', 'BD_DOLT_PORT', 'BD_DOLT_MODE', 'BD_DOLT_SHARED_SERVER',
  'BEADS_SKIP_IDENTITY_CHECK',
];
const INPUT_FIELDS: Record<string, readonly string[]> = {
  projects: [], snapshot: [], issue: ['id'],
  create: ['title', 'description', 'type', 'priority', 'assignee', 'labels'],
  update: ['id', 'title', 'description', 'priority', 'assignee', 'status', 'notes', 'acceptance', 'design'],
  claim: ['id'], close: ['id', 'reason'], reopen: ['id'], reclaim: ['id'],
  link: ['id', 'dependsOn', 'type'], unlink: ['id', 'dependsOn'],
  comment: ['id', 'text'], comments: ['id'],
};

type Row = Record<string, unknown>;
type Run = (args: string[], readonly: boolean, json?: boolean) => Promise<unknown>;

function object(value: unknown, context: string): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Row;
}

function text(value: unknown, field: string, required = false): string {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > TEXT_LIMIT || (required && !value.trim())) {
    throw new Error(`${field} must be ${required ? 'a nonempty' : 'a'} string of at most 64 KiB without NUL bytes`);
  }
  return value;
}

function id(value: unknown, field = 'id'): string {
  const result = text(value, field, true);
  // reclaim --id uses a CSV flag; one request must never expand to multiple IDs.
  if (result.length > 256 || /[\s,]/u.test(result)) throw new Error(`${field} must be a single issue ID`);
  return result;
}

function priority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4) {
    throw new Error('priority must be an integer from 0 to 4');
  }
  return value;
}

function inputFor(request: RpcRequest): Row {
  const fields = INPUT_FIELDS[request.method];
  if (!Object.hasOwn(INPUT_FIELDS, request.method) || !fields) throw new Error(`Unsupported method: ${request.method}`);
  const input = request.input === undefined ? {} : object(request.input, 'input');
  for (const key of Object.keys(input)) {
    if (!fields.includes(key)) throw new Error(`Unsupported input for ${request.method}: ${key}`);
    const value = input[key];
    if (value === undefined) continue;
    if (key === 'id' || key === 'dependsOn') id(value, key);
    else if (key === 'priority') priority(value);
    else if (key === 'labels') {
      if (!Array.isArray(value) || value.length > 100) throw new Error('labels must be an array of at most 100 strings');
      for (const label of value) {
        text(label, 'label', true);
        if (/[,\r\n]/u.test(label)) throw new Error('labels cannot contain commas or line breaks');
      }
    } else text(value, key, ['title', 'text', 'type', 'status'].includes(key));
  }
  if (fields.includes('id')) id(input.id);
  if (fields.includes('dependsOn')) id(input.dependsOn, 'dependsOn');
  if (request.method === 'create') text(input.title, 'title', true);
  if (request.method === 'comment') text(input.text, 'text', true);
  if (request.method === 'update' && !fields.some((key) => key !== 'id' && input[key] !== undefined)) {
    throw new Error('update requires at least one changed field');
  }
  return input;
}

async function runner(project: Project): Promise<Run> {
  if (!isAbsolute(project.path)) throw new Error(`Registered project ${project.id} must have an absolute path`);
  const beadsDir = join(project.path, '.beads');
  try {
    if (!(await stat(beadsDir)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new Error(`Registered project ${project.id} has no accessible .beads directory; initialize that workspace with bd first`, { cause: error });
  }
  const key = await realpath(beadsDir);
  const env: NodeJS.ProcessEnv = {
    ...process.env, BEADS_DIR: beadsDir, BD_LAST_TOUCHED_FALLBACK: '0',
    // list/ready also support contributor auto-routing; pin the current store.
    BD_ROUTING_MODE: 'explicit', BD_ROUTING_DEFAULT: '.',
    // config.go maps directory.labels through Viper to this JSON map override.
    // Suppress list/ready directory filters without discarding hydrated labels.
    BD_DIRECTORY_LABELS: '{}',
  };
  for (const name of ROUTING_ENV) delete env[name];
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let remainingBytes = OUTPUT_LIMIT;
  const execute: Run = async (args, readonly, json = true) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`bd request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    if (remainingBytes <= 0) throw new Error('bd output exceeded the 16 MiB request limit');
    const argv = ['--json', '--no-color', ...(readonly ? ['--readonly'] : []), ...args];
    const execution = executeFile('bd', argv, {
      cwd: project.path, env, encoding: 'utf8', shell: false,
      timeout: remainingMs, killSignal: 'SIGKILL', maxBuffer: remainingBytes,
      windowsHide: true,
    });
    // Never inherit a terminal or wait for interactive stdin.
    execution.child.stdin?.end();
    let output: string;
    try {
      const { stdout, stderr } = await execution;
      remainingBytes -= Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      output = stdout;
    } catch (cause) {
      const error = cause as ExecFileException & { stdout?: string; stderr?: string };
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        throw new Error('bd output exceeded the 16 MiB request limit; no partial result returned', { cause });
      }
      const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
      const reason = error.killed ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : `failed (${error.code ?? error.signal ?? 'unknown'})`;
      throw new Error(`bd ${args[0]} ${reason}: ${detail.slice(0, 8192)}`, { cause });
    }
    if (remainingBytes < 0) throw new Error('bd output exceeded the 16 MiB request limit; no partial result returned');
    if (!json) {
      // Mutation results have no prescribed JSON shape. Preserve native text
      // rather than turn a successful write into a parse error and invite retry.
      try { return JSON.parse(output) as unknown; } catch { return output.trim() || null; }
    }
    try { return JSON.parse(output) as unknown; } catch (error) {
      throw new Error(`bd ${args[0]} returned invalid JSON`, { cause: error });
    }
  };
  return (args, readonly, json) => {
    // Embedded Dolt has a process-level store lock. Serialize CLI processes
    // within this host, without holding unrelated registered projects back.
    const operation = (processQueues.get(key) ?? Promise.resolve()).then(() => execute(args, readonly, json));
    const settled = operation.then(() => undefined, () => undefined);
    processQueues.set(key, settled);
    void settled.then(() => {
      if (processQueues.get(key) === settled) processQueues.delete(key);
    });
    return operation;
  };
}

function rows(value: unknown, context: string): Row[] {
  // Go nil slices encode as null, including empty dep/comment/query results.
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error(`bd ${context} returned a non-array result`);
  return value.map((row) => object(row, `bd ${context} row`));
}

function stringField(row: Row, field: string, required = false): string {
  const value = row[field];
  if (!required && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (required && !value)) throw new Error(`bd issue has invalid ${field}`);
  return value;
}

function normalizeIssue(row: Row): Issue {
  if (typeof row.priority !== 'number' || !Number.isInteger(row.priority)) throw new Error('bd issue has invalid priority');
  const labels = row.labels ?? [];
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string')) throw new Error('bd issue has invalid labels');
  const issue: Issue = {
    id: stringField(row, 'id', true), title: stringField(row, 'title', true),
    description: stringField(row, 'description'), status: stringField(row, 'status'),
    priority: row.priority, type: stringField(row, 'issue_type'), assignee: stringField(row, 'assignee'),
    labels, dependencies: [], createdAt: stringField(row, 'created_at', true), updatedAt: stringField(row, 'updated_at', true),
  };
  const optionalStrings = {
    closed_at: 'closedAt', notes: 'notes', acceptance_criteria: 'acceptance', design: 'design',
    due_at: 'dueAt', defer_until: 'deferUntil', heartbeat_at: 'heartbeatAt',
  } as const;
  for (const [source, target] of Object.entries(optionalStrings)) {
    if (row[source] !== undefined && row[source] !== null) issue[target] = stringField(row, source);
  }
  if (row.estimated_minutes !== undefined && row.estimated_minutes !== null) {
    if (typeof row.estimated_minutes !== 'number' || !Number.isInteger(row.estimated_minutes)) throw new Error('bd issue has invalid estimated_minutes');
    issue.estimatedMinutes = row.estimated_minutes;
  }
  return issue;
}

async function issuesWithDependencies(value: unknown, run: Run): Promise<Issue[]> {
  const issues = rows(value, 'issues').map(normalizeIssue);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  // bd 1.3.2 dep.go: single-ID hydration drops targets absent from this store.
  // Repeat a lone anchor to select raw edges, as dep_list_cross_db_test.go does.
  // readDepListEdges deduplicates anchors, so this does not duplicate edges.
  for (let offset = 0; offset < issues.length; offset += DEPENDENCY_BATCH_SIZE) {
    const ids = issues.slice(offset, offset + DEPENDENCY_BATCH_SIZE).map((issue) => issue.id);
    if (ids.length === 1) ids.push(ids[0]!);
    const dependencies = rows(await run(['dep', 'list', '--direction=down', '--', ...ids], true), 'dep list');
    for (const dependency of dependencies) {
      const issue = byId.get(stringField(dependency, 'issue_id', true));
      if (!issue) throw new Error('bd dep list returned an unexpected source issue');
      issue.dependencies.push({
        id: stringField(dependency, 'depends_on_id', true),
        type: stringField(dependency, 'type', true),
      });
    }
  }
  return issues;
}

function flags(input: Row, fields: readonly string[]): string[] {
  return fields.filter((field) => input[field] !== undefined).map((field) => `--${field}=${String(input[field])}`);
}

/** The sole host RPC entrypoint. project is a host-registered ID, never a path. */
export async function handleRequest(request: RpcRequest, projects: Project[]): Promise<unknown> {
  object(request, 'request');
  if (typeof request.method !== 'string') throw new Error('request.method must be a string');
  const input = inputFor(request);
  if (request.method === 'projects') return projects.map((project) => ({ ...project }));
  const project = projects.find((candidate) => candidate.id === request.project);
  if (!project) throw new Error('A registered project ID is required');
  const run = await runner(project);
  // Reject IDs absent from the local list; no shorthand is accepted here.
  // This is a precheck, not atomic isolation: bd 1.3.2 may prefix-route if an
  // external actor deletes the local ID before the next native command.
  for (const field of ['id', 'dependsOn'] as const) {
    if (input[field] === undefined) continue;
    const local = rows(await run([...LIST_ALL, `--id=${String(input[field])}`], true), 'list');
    if (local.length !== 1 || local[0]?.id !== input[field]) {
      throw new Error(`Issue ${String(input[field])} not found in registered project ${project.id}`);
    }
  }
  switch (request.method) {
    case 'snapshot': {
      // Explicit unlimited queries: bd defaults to 50 list / 100 ready rows.
      // Include every stored status and normally hidden category; do not export
      // (export has owner filters and omits the ephemeral storage plane).
      const issues = await issuesWithDependencies(await run(LIST_ALL, true), run);
      const readyIds = rows(await run(['ready', '--limit=0', '--include-ephemeral'], true), 'ready').map((row) => stringField(row, 'id', true));
      const blockedIds = rows(await run(['blocked'], true), 'blocked').map((row) => stringField(row, 'id', true));
      const snapshot: Snapshot = { project: { ...project }, issues, readyIds, blockedIds, fetchedAt: new Date().toISOString() };
      return snapshot;
    }
    case 'issue': {
      const issues = await issuesWithDependencies(await run(['show', '--brief-deps', `--id=${String(input.id)}`], true), run);
      if (issues.length !== 1) throw new Error('bd show did not return exactly one issue');
      return issues[0];
    }
    case 'create': {
      const args = ['create', '--repo=.', ...flags(input, ['title', 'description', 'type', 'priority', 'assignee'])];
      if (input.labels !== undefined) args.push(`--labels=${(input.labels as string[]).map((label) => `"${label.replaceAll('"', '""')}"`).join(',')}`);
      return run(args, false, false);
    }
    case 'update':
      return run(['update', ...flags(input, ['title', 'description', 'priority', 'assignee', 'status', 'notes', 'acceptance', 'design']), '--', String(input.id)], false, false);
    case 'claim':
      return run(['update', '--claim', '--', String(input.id)], false, false);
    case 'close':
      return run(['close', ...flags(input, ['reason']), '--', String(input.id)], false, false);
    case 'reopen':
      return run(['reopen', '--', String(input.id)], false, false);
    case 'reclaim':
      return run(['reclaim', `--id=${String(input.id)}`], false, false);
    case 'link':
      return run(['dep', 'add', ...flags(input, ['type']), '--', String(input.id), String(input.dependsOn)], false, false);
    case 'unlink':
      return run(['dep', 'remove', '--', String(input.id), String(input.dependsOn)], false, false);
    case 'comment':
      return run(['comment', '--', String(input.id), String(input.text)], false, false);
    case 'comments':
      return rows(await run(['comments', '--', String(input.id)], true), 'comments');
    default:
      throw new Error(`Unsupported method: ${request.method}`);
  }
}
