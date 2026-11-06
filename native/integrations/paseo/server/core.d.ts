import type { BeadsRequest, Project } from "../shared/rpc.js";

/** Implemented by the root build: src/core/service.ts bundled as server/core.js. */
export declare function handleRequest(request: BeadsRequest, projects: Project[]): Promise<unknown>;
