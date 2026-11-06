import type { Project, RpcRequest } from '../shared.js';

const inputFields = {
  projects: [],
  snapshot: [],
  issue: ['id'],
  create: ['title', 'description', 'type', 'priority', 'assignee', 'labels'],
  update: ['id', 'title', 'description', 'priority', 'assignee', 'status', 'notes', 'acceptance', 'design'],
  claim: ['id'],
  close: ['id', 'reason'],
  reopen: ['id'],
  reclaim: ['id'],
  link: ['id', 'dependsOn', 'type'],
  unlink: ['id', 'dependsOn'],
  comment: ['id', 'text'],
  comments: ['id'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** Only a host-owned top-level renderer at the bundled document may use IPC. */
export function assertTrustedDocument(ownedMainFrame: boolean, actualUrl: string, documentUrl: string): void {
  if (!ownedMainFrame) throw new Error('Untrusted desktop IPC sender');
  try {
    const actual = new URL(actualUrl);
    actual.search = '';
    actual.hash = '';
    if (actual.protocol !== 'beads:' || actual.href !== documentUrl) throw new Error('wrong document');
  } catch {
    throw new Error('Untrusted desktop IPC sender');
  }
}

/** Check the complete wire shape before handing the request to the core service. */
export function authorizeDesktopRequest(value: unknown, projects: readonly Project[]): RpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Beads request');
  if (Object.keys(value).some((key) => !['method', 'project', 'input'].includes(key))) {
    throw new Error('Invalid Beads request');
  }
  const { method, project, input } = value as Record<string, unknown>;
  if (typeof method !== 'string' || !Object.hasOwn(inputFields, method)) {
    throw new Error('Unknown Beads method');
  }
  const allowedFields: readonly string[] = inputFields[method as keyof typeof inputFields];
  if (method === 'projects') {
    if (project !== undefined) throw new Error('Projects request cannot specify a project');
  } else if (typeof project !== 'string' || !projects.some((item) => item.id === project)) {
    throw new Error('Project is not selected');
  }
  if (input !== undefined) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid Beads input');
    for (const [key, field] of Object.entries(input)) {
      if (!allowedFields.includes(key)) throw new Error(`Unsupported Beads input: ${key}`);
      if (key === 'priority') {
        if (typeof field !== 'number' || !Number.isFinite(field)) throw new Error('Invalid priority');
      } else if (key === 'labels') {
        if (!Array.isArray(field) || !field.every((label) => typeof label === 'string')) throw new Error('Invalid labels');
      } else if (typeof field !== 'string') {
        throw new Error(`Invalid Beads input: ${key}`);
      }
    }
  }
  return { method, ...(typeof project === 'string' ? { project } : {}), ...(input === undefined ? {} : { input: input as Record<string, unknown> }) };
}
