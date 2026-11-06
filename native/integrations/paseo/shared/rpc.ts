import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const methods = ["projects", "snapshot", "issue", "create", "update", "claim", "close", "reopen", "reclaim", "link", "unlink", "comment", "comments"] as const;
export const requestSchema = z.object({
  method: z.enum(methods),
  project: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type BeadsRequest = z.infer<typeof requestSchema>;
export const beadsRpc = defineRpc({ name: "beads.request", input: requestSchema, output: z.unknown() });

// Wire schemas mirror src/shared.ts; no runtime-specific imports may cross Paseo's shared boundary.
export const projectSchema = z.object({ id: z.string(), name: z.string(), path: z.string() });
export const issueSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), status: z.string(), priority: z.number(),
  type: z.string(), assignee: z.string(), labels: z.array(z.string()),
  dependencies: z.array(z.object({ id: z.string(), type: z.string() })),
  updatedAt: z.string(), createdAt: z.string(), closedAt: z.string().optional(),
  notes: z.string().optional(), acceptance: z.string().optional(), design: z.string().optional(),
  estimatedMinutes: z.number().optional(), dueAt: z.string().optional(), deferUntil: z.string().optional(), heartbeatAt: z.string().optional(),
});
export const snapshotSchema = z.object({
  project: projectSchema, issues: z.array(issueSchema), readyIds: z.array(z.string()),
  blockedIds: z.array(z.string()), fetchedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
