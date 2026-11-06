import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defineAgentTool } from "@getpaseo/plugin/server";
import { beadsRpc, requestSchema } from "./shared/rpc.js";
import { handleBeads } from "./server/beads.js";

export default function contribute(server: PluginServerContext) {
  server.handle(beadsRpc, (input, context) => handleBeads(input, context.paseo));
  return server.before("agent.session_open", ({ request }) => {
    if (request.purpose !== "interactive" || !request.workspaceId) return;
    request.tools.push(defineAgentTool({
      name: "beads",
      title: "Beads issues",
      description: "Read and manage Beads issues in this agent's Paseo workspace. Use snapshot for ready/blocked IDs. Mutations must be explicitly requested; never close an issue just because an agent turn ended.",
      input: requestSchema.omit({ project: true }).extend({
        method: requestSchema.shape.method.exclude(["projects"]),
      }),
      async execute(input, context) {
        if (!context.agent.workspaceId) throw new Error("This agent has no Paseo workspace.");
        const result = await handleBeads({ ...input, project: context.agent.workspaceId }, context.paseo);
        return {
          structuredContent: result !== null && typeof result === "object" && !Array.isArray(result)
            ? result
            : { result },
          text: JSON.stringify(result) ?? "null",
        };
      },
    }));
    return request;
  });
}
