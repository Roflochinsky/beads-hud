import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const bridge = resolve('dist/tern/bridge.mjs');
function request(cwd: string, input: unknown): { code: number | null; body: Record<string, unknown> } {
  const child = spawnSync(process.execPath, [bridge], {
    cwd, input: JSON.stringify(input), encoding: 'utf8', timeout: 30_000,
  });
  if (child.error) throw child.error;
  const body: unknown = JSON.parse(child.stdout);
  assert.ok(body && typeof body === 'object' && !Array.isArray(body), child.stderr);
  return { code: child.status, body: body as Record<string, unknown> };
}

test('Tern bridge exposes only its host supplied workspace, never an RPC supplied path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beads-tern-'));
  const cwd = join(root, 'workspace');
  const alias = join(root, 'alias');
  try {
    await mkdir(cwd);
    await symlink(cwd, alias, 'dir');
    const projects = request(alias, { method: 'projects' });
    assert.equal(projects.code, 0);
    assert.equal(projects.body.ok, true);
    assert.ok(Array.isArray(projects.body.result));
    assert.equal(projects.body.result.length, 1);
    const [project] = projects.body.result;
    assert.ok(project && typeof project === 'object' && 'path' in project && typeof project.path === 'string');
    assert.equal(await realpath(project.path), await realpath(cwd));
    const denied = await request(cwd, { method: 'snapshot', project: '/some/other/workspace' });
    assert.equal(denied.code, 1);
    assert.equal(denied.body.ok, false);
    assert.equal('result' in denied.body, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Tern bridge returns explicit failures for malformed requests and unsupported methods', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'beads-tern-'));
  try {
    for (const input of [null, { method: 1 }, { method: 'snapshot', input: [] }, { method: 'shell' }]) {
      const response = request(cwd, input);
      assert.equal(response.code, 1);
      assert.equal(response.body.ok, false);
      assert.equal(typeof response.body.error, 'string');
      assert.equal('result' in response.body, false);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
