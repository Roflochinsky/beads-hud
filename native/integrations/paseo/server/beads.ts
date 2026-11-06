import { handleRequest } from "./core.js";
import { requestSchema } from "../shared/rpc.js";
import type { BeadsRequest, Project } from "../shared/rpc.js";

// The public SDK's workspaces.list result, restricted to the fields this adapter consumes.
export interface WorkspaceHost {
  workspaces: {
    list(options?: { filter?: { includeBackground?: boolean }; page?: { limit: number; cursor?: string } }): Promise<{
      entries: { id: string; name: string; projectRootPath: string; workspaceDirectory?: string }[];
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    }>;
  };
}

export async function handleBeads(input: BeadsRequest, host: WorkspaceHost): Promise<unknown> {
  const request = requestSchema.parse(input);
  const projects: Project[] = [];
  let cursor: string | undefined;
  do {
    const page = await host.workspaces.list({
      filter: { includeBackground: true },
      page: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    for (const workspace of page.entries) {
      projects.push({ id: workspace.id, name: workspace.name, path: workspace.workspaceDirectory ?? workspace.projectRootPath });
    }
    if (!page.pageInfo.hasMore) break;
    if (!page.pageInfo.nextCursor || page.pageInfo.nextCursor === cursor) {
      throw new Error("Paseo returned an incomplete workspace page without a new cursor.");
    }
    cursor = page.pageInfo.nextCursor;
  } while (true);
  if (request.method !== "projects" && !projects.some((project) => project.id === request.project)) {
    throw new Error("Select a workspace registered with this Paseo host.");
  }
  return handleRequest(request, projects);
}
