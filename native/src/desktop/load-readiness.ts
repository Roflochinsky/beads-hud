import { handleRequest } from '../core/service.js';
import type { Project, Snapshot } from '../shared.js';
import { summarizeSnapshots, type ReadinessState } from './readiness.js';

/** A failed project makes the aggregate unavailable, never a misleading partial count. */
export async function loadReadiness(projects: Project[]): Promise<ReadinessState> {
  if (projects.length === 0) return { kind: 'unconfigured' };
  const snapshots = await Promise.all(projects.map(async (project) =>
    await handleRequest({ method: 'snapshot', project: project.id }, projects) as Snapshot,
  ));
  return { kind: 'ready', readiness: summarizeSnapshots(snapshots) };
}
