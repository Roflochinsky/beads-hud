export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  type: string;
  assignee: string;
  labels: string[];
  dependencies: { id: string; type: string }[];
  updatedAt: string;
  createdAt: string;
  closedAt?: string;
  notes?: string;
  acceptance?: string;
  design?: string;
  estimatedMinutes?: number;
  dueAt?: string;
  deferUntil?: string;
  heartbeatAt?: string;
}

export interface Snapshot {
  project: Project;
  issues: Issue[];
  readyIds: string[];
  blockedIds: string[];
  fetchedAt: string;
}

export interface RpcRequest {
  method: string;
  project?: string;
  input?: Record<string, unknown>;
}

export interface Transport {
  request<T = unknown>(request: RpcRequest): Promise<T>;
}
