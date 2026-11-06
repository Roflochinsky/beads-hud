import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { once } from 'node:events';
import { get } from 'node:http';
import { startServer } from '../src/server/http.js';

test('loopback server rejects unauthorized and cross-origin mutations while allowing registered project discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beads-http-'));
  const web = join(root, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<main>Beads Board</main>');
  const projects = [{ id: 'allowed', name: 'Allowed workspace', path: root }];
  const runtime = await startServer({ projects, staticDir: web });
  try {
    const post = (headers: Record<string, string>) => fetch(`${runtime.url}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ method: 'projects' }) });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: `Bearer ${runtime.token}`, Origin: 'https://attacker.invalid' })).status, 403);
    const authorized = await post({ Authorization: `Bearer ${runtime.token}`, Origin: runtime.url });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), projects);
    const foreignHost = get(`${runtime.url}/`, { headers: { Host: 'attacker.invalid' } });
    const [foreignResponse] = await once(foreignHost, 'response');
    foreignResponse.resume();
    assert.equal(foreignResponse.statusCode, 403);
    await writeFile(join(root, 'outside.txt'), 'Must not leave the static root');
    await symlink(join(root, 'outside.txt'), join(web, 'linked.txt'));
    assert.equal((await fetch(`${runtime.url}/linked.txt`)).status, 404);
  } finally {
    const closed = once(runtime.server, 'close');
    runtime.server.close();
    runtime.server.closeAllConnections();
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP accepts maximum shared comments including JSON escaping and enforces aggregate byte bounds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beads-http-text-'));
  const previousPath = process.env.PATH;
  await mkdir(join(root, '.beads'));
  await writeFile(join(root, 'bd'), `#!${process.execPath}
    const args = process.argv.slice(2);
    if (args.includes('list')) process.stdout.write(JSON.stringify([{ id: 'fixture-1' }]));
    else if (args.includes('comment')) {
      const values = args.slice(args.indexOf('--') + 1);
      process.stdout.write(JSON.stringify({ id: values[0], text: values[1] }));
    } else process.exit(90);
  `, { mode: 0o755 });
  process.env.PATH = `${root}${delimiter}${previousPath ?? ''}`;
  const projects = [{ id: 'allowed', name: 'Allowed workspace', path: root }];
  const runtime = await startServer({ projects, staticDir: root });
  try {
    const post = (body: string) => fetch(`${runtime.url}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runtime.token}`, Origin: runtime.url },
      body,
    });
    const comment = (text: string) => JSON.stringify({
      method: 'comment', project: 'allowed', input: { id: 'fixture-1', text },
    });
    for (const text of ['a'.repeat(65536), '\u0001'.repeat(65536), '🙂'.repeat(16384), 'x\n'.repeat(32768)]) {
      const response = await post(comment(text));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: 'fixture-1', text });
    }
    // Shared text bound remains 64 KiB decoded UTF-8, independently of HTTP.
    assert.equal((await post(comment('a'.repeat(65537)))).status, 400);
    // Legal JSON whitespace exercises the actual transport byte boundary
    // without coupling the assertion to error-message wording.
    const discovery = JSON.stringify({ method: 'projects' });
    const atLimit = discovery.padEnd(40 * 1024 * 1024, ' ');
    const accepted = await post(atLimit);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), projects);
    assert.equal((await post(`${atLimit} `)).status, 413);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    const closed = once(runtime.server, 'close');
    runtime.server.close();
    runtime.server.closeAllConnections();
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});
