import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReadiness, summarizeSnapshots, waybarOutput } from './readiness.js';
import type { Issue, Snapshot } from '../shared.js';

const issue = (id: string, status: string, closedAt?: string): Issue => ({
  id, status, ...(closedAt ? { closedAt } : {}), title: id, description: '', priority: 2, type: 'task', assignee: '',
  labels: [], dependencies: [], updatedAt: '', createdAt: '',
});

test('Waybar represents real ready IDs and recent active/closed issues from all selected snapshots', () => {
  const snapshots: Snapshot[] = [{
    project: { id: 'a', name: 'A', path: '/a' },
    issues: [issue('one', 'open'), issue('two', 'in_progress'), issue('three', 'closed', '2026-11-05T00:00:00Z')],
    readyIds: ['one'], blockedIds: [], fetchedAt: '2026-11-06T00:00:00Z',
  }, {
    project: { id: 'b', name: 'B', path: '/b' },
    issues: [issue('four', 'open')], readyIds: ['four'], blockedIds: [], fetchedAt: '2026-11-06T00:00:00Z',
  }];
  const state = summarizeSnapshots(snapshots, Date.parse('2026-11-06T00:00:00Z'));
  assert.deepEqual(state, { ready: 2, active: true, done: true, hasIssues: true, projectCount: 2 });
  assert.equal(waybarOutput({ kind: 'ready', readiness: state }).tooltip, 'Beads: 2 ready across 2 projects');
});

test('Waybar does not report zero when no project is configured or a snapshot fails', () => {
  assert.equal(waybarOutput({ kind: 'unconfigured' }).text.includes('0'), false);
  const output = waybarOutput({ kind: 'error', message: 'bd not found' });
  assert.equal(output.text.includes('0'), false);
  assert.match(output.tooltip, /bd not found/);
});

test('the Omarchy shell receives the same real readiness state and explicit errors', () => {
  const readiness = { ready: 2, active: true, done: false, hasIssues: true, projectCount: 1 };
  assert.deepEqual(JSON.parse(formatReadiness({ kind: 'ready', readiness }, 'omarchy')), {
    kind: 'ready', readiness: { ready: 2, active: true, done: false, hasIssues: true, projectCount: 1 },
  });
  assert.deepEqual(JSON.parse(formatReadiness({ kind: 'error', message: 'bd not found' }, 'omarchy')), {
    kind: 'error', message: 'bd not found',
  });
});
