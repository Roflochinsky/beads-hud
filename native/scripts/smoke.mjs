import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../dist/paseo/server/core.js';

const root = await mkdtemp(join(tmpdir(), 'beads-board-smoke-'));
const projectPath = join(root, 'project');
await mkdir(projectPath);
await mkdir(join(root, 'home'));
for (const key of Object.keys(process.env)) if (/^(BEADS_|BD_|DOLT_|GIT_DIR$|GIT_WORK_TREE$)/.test(key)) delete process.env[key];
Object.assign(process.env, { HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'home', '.config'), BEADS_ACTOR: 'beads-board-smoke', BD_NON_INTERACTIVE: '1', CI: 'true' });
const projects = [{ id: 'smoke', name: 'Smoke workspace', path: projectPath }];
const call = (method, input) => handleRequest({ method, project: 'smoke', input }, projects);
try {
  execFileSync('git', ['init', '--quiet'], { cwd: projectPath });
  execFileSync('git', ['config', 'user.name', 'Beads Board Smoke'], { cwd: projectPath });
  execFileSync('git', ['config', 'user.email', 'smoke@example.invalid'], { cwd: projectPath });
  execFileSync('bd', ['init', '--prefix', 'smoke', '--non-interactive', '--skip-agents', '--skip-hooks'], { cwd: projectPath, stdio: 'pipe', timeout: 120000 });
  // Only this disposable fixture is configured; registered user configs are
  // never rewritten. The board must ignore this filter, not erase issue labels.
  await appendFile(join(projectPath, '.beads', 'config.yaml'), '\ndirectory:\n  labels:\n    project: lane:not-present\n');
  await call('create', { title: 'Build Beads integration', description: 'Real isolated smoke issue', type: 'task', priority: 1 });
  const first = await call('snapshot');
  assert.equal(first.issues.length, 1, 'directory defaults must not hide the new unlabeled issue');
  const externalSource = first.issues[0];
  const externalEdge = { id: 'external:other:capability', type: 'related' };
  // Seed an existing native edge outside the RPC's local-endpoint mutation
  // surface. A one-issue snapshot and detail must both preserve external-only edges.
  execFileSync('bd', ['dep', 'add', '--type=related', '--', externalSource.id, externalEdge.id], { cwd: projectPath, stdio: 'pipe', timeout: 30000 });
  assert.deepEqual((await call('snapshot')).issues[0].dependencies, [externalEdge]);
  assert.deepEqual((await call('issue', { id: externalSource.id })).dependencies, [externalEdge]);
  await call('create', { title: 'Verify host panel', type: 'task', priority: 2 });
  let snapshot = await call('snapshot');
  const blocker = snapshot.issues.find((issue) => issue.title === 'Build Beads integration');
  const dependent = snapshot.issues.find((issue) => issue.title === 'Verify host panel');
  assert.ok(blocker && dependent, 'created issues must be present in the authoritative snapshot');
  await call('link', { id: dependent.id, dependsOn: blocker.id, type: 'blocks' });
  snapshot = await call('snapshot');
  assert.ok(snapshot.blockedIds.includes(dependent.id));
  assert.ok(!snapshot.readyIds.includes(dependent.id));
  assert.deepEqual(snapshot.issues.find((issue) => issue.id === dependent.id).dependencies, [{ id: blocker.id, type: 'blocks' }]);
  assert.deepEqual((await call('issue', { id: dependent.id })).dependencies, [{ id: blocker.id, type: 'blocks' }]);
  await call('claim', { id: blocker.id });
  assert.equal((await call('issue', { id: blocker.id })).status, 'in_progress');
  await call('close', { id: blocker.id, reason: 'Smoke verified' });
  snapshot = await call('snapshot');
  assert.ok(snapshot.readyIds.includes(dependent.id), 'closing a blocker makes its dependent ready');
  assert.ok(!snapshot.blockedIds.includes(dependent.id), 'closed target no longer blocks its dependent');
  assert.deepEqual(snapshot.issues.find((issue) => issue.id === dependent.id).dependencies, [{ id: blocker.id, type: 'blocks' }]);
  assert.deepEqual((await call('issue', { id: dependent.id })).dependencies, [{ id: blocker.id, type: 'blocks' }]);
  await call('reopen', { id: blocker.id });
  snapshot = await call('snapshot');
  assert.ok(!snapshot.readyIds.includes(dependent.id), 'reopened blocker removes dependent from ready');
  await call('unlink', { id: dependent.id, dependsOn: blocker.id });
  await call('update', { id: dependent.id, title: 'Verify live host panel', priority: 0 });
  assert.equal((await call('issue', { id: dependent.id })).priority, 0);
  await call('comment', { id: dependent.id, text: 'Verified through real bd, not a mock.' });
  const comments = await call('comments', { id: dependent.id });
  assert.match(JSON.stringify(comments), /Verified through real bd/);
  await assert.rejects(() => handleRequest({ method: 'snapshot', project: 'not-registered' }, projects));
  console.log('PASS: directory-default suppression, singleton external edges, create, dependencies before/after close, ready/blocked transitions, claim, reopen, unlink, update, comments and registered-project selection.');
  if (process.argv.includes('--keep')) console.log(`Fixture retained: ${projectPath}`);
} finally {
  if (!process.argv.includes('--keep')) await rm(root, { recursive: true, force: true });
}
