import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = resolve(process.argv[2] ?? (process.platform === 'darwin'
  ? `release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Beads Board.app/Contents/MacOS/Beads Board`
  : 'release/linux-unpacked/beads-board'));
const root = await realpath(await mkdtemp(join(tmpdir(), 'beads-desktop-smoke-')));
const project = join(root, 'project');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BEADS_|BD_|DOLT_)/.test(key)
  && !['GIT_DIR', 'GIT_WORK_TREE', 'NODE_OPTIONS', 'WAYLAND_DISPLAY'].includes(key)));
Object.assign(env, { HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'home', '.config'), BEADS_ACTOR: 'packaged-desktop-smoke', BD_NON_INTERACTIVE: '1' });
const native = (command, args) => execFileSync(command, args, { cwd: project, env, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
const deadline = (promise, label, ms = 30_000) => Promise.race([
  promise,
  delay(ms, undefined, { ref: false }).then(() => { throw new Error(`${label} timed out after ${ms}ms`); }),
]);
let child;
let socket;
let childExit;
let log = '';
const pending = new Map();
let sequence = 0;
function rpc(method, params = {}, sessionId) {
  const id = ++sequence;
  const result = Promise.withResolvers();
  pending.set(id, result);
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return deadline(result.promise, method).finally(() => pending.delete(id));
}
async function evaluate(sessionId, expression) {
  const reply = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
  return reply.result.value;
}
async function until(read, label) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`${label} did not become ready`);
}
try {
  await mkdir(project);
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  native('git', ['init', '-q']);
  native('git', ['config', '--local', 'user.name', 'Packaged desktop smoke']);
  native('git', ['config', '--local', 'user.email', 'desktop-smoke@example.invalid']);
  native('bd', ['init', '--prefix', 'desktop', '--non-interactive', '--skip-agents', '--skip-hooks']);
  const initial = JSON.parse(native('bd', ['--json', 'create', '--title=Packaged desktop acceptance', '--type=task', '--priority=1']));
  const address = Promise.withResolvers();
  child = spawn(executable, ['--remote-debugging-port=0', '--project', project, ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    log = (log + chunk.toString()).slice(-131_072);
    const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) address.resolve(match[1]);
  });
  const exited = Promise.withResolvers();
  childExit = exited.promise;
  child.once('error', (error) => { address.reject(error); exited.resolve(); });
  child.once('exit', (code, signal) => {
    address.reject(new Error(`Desktop exited before debugging was ready (${code ?? signal})`));
    exited.resolve();
  });
  socket = new WebSocket(await deadline(address.promise, 'Desktop debugging endpoint'));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    const request = pending.get(message.id);
    if (request) message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Desktop debugging connection closed'));
  });
  await once(socket, 'open', { signal: AbortSignal.timeout(15_000) });
  const target = await until(async () => (await rpc('Target.getTargets')).targetInfos.find((item) => item.type === 'page' && item.url.startsWith('beads://app/')), 'Packaged renderer');
  const { sessionId } = await rpc('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await until(() => evaluate(sessionId, `typeof window.beadsTransport?.request === 'function' && document.body?.innerText.includes('Packaged desktop acceptance')`), 'Rendered Beads issue');
  const observed = await evaluate(sessionId, `(async () => {
    const projects = await window.beadsTransport.request({method:'projects'});
    const snapshot = await window.beadsTransport.request({method:'snapshot',project:projects[0].id});
    return {projects,snapshot,node:typeof process,require:typeof require,origin:location.origin,width:innerWidth,height:innerHeight,panelHeight:document.querySelector('.tray-panel').getBoundingClientRect().height};
  })()`);
  assert.equal(observed.node, 'undefined');
  assert.equal(observed.require, 'undefined');
  assert.equal(observed.origin, 'beads://app');
  assert.equal(observed.projects.length, 1);
  assert.equal(await realpath(observed.projects[0].path), project);
  assert.ok(observed.snapshot.readyIds.includes(initial.id));
  assert.equal(observed.width, process.platform === 'darwin' ? 400 : 760);
  assert.equal(observed.height, observed.panelHeight, 'The native popup must not leave an empty band below the tray surface');
  const projectId = JSON.stringify(observed.projects[0].id);
  const created = await evaluate(sessionId, `(async () => {
    await window.beadsTransport.request({method:'create',project:${projectId},input:{title:'Packaged renderer write',type:'task',priority:2}});
    const snapshot = await window.beadsTransport.request({method:'snapshot',project:${projectId}});
    document.querySelector('[data-action="refresh"]').click();
    return snapshot.issues.find(issue => issue.title === 'Packaged renderer write');
  })()`);
  assert.ok(created?.id);
  const persisted = JSON.parse(native('bd', ['--json', '--readonly', 'show', '--', created.id]));
  assert.equal(persisted[0].title, 'Packaged renderer write');
  await until(() => evaluate(sessionId, `document.body.innerText.includes('Packaged renderer write')`), 'Rendered persisted mutation');
  await evaluate(sessionId, `document.querySelector('input[type="search"]').focus()`);
  await rpc('Input.insertText', { text: 'Packaged ' }, sessionId);
  await rpc('Input.insertText', { text: 'renderer write' }, sessionId);
  const searched = await evaluate(sessionId, `(() => {
    const search = document.querySelector('input[type="search"]');
    return {query:search.value,focused:document.activeElement===search,ids:Array.from(document.querySelectorAll('.tray-row__button[data-id]'),row=>row.dataset.id)};
  })()`);
  assert.deepEqual(searched, { query: 'Packaged renderer write', focused: true, ids: [created.id] });
  await evaluate(sessionId, `document.querySelector('input[type="search"]').select()`);
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, sessionId);
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, sessionId);
  await evaluate(sessionId, 'document.fonts.ready.then(() => true)');
  const capture = await rpc('Page.captureScreenshot', { format: 'png' }, sessionId);
  await mkdir('artifacts', { recursive: true });
  const screenshot = `artifacts/desktop-${process.platform}-${process.arch}.png`;
  await writeFile(screenshot, Buffer.from(capture.data, 'base64'));
  console.log(`PASS: packaged ${process.platform}/${process.arch} startup, secure renderer, native issue, IPC write, search focus, ${observed.width}px tray and screenshot ${screenshot}`);
} catch (error) {
  console.error(log.slice(-8192));
  throw error;
} finally {
  socket?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    try { await deadline(childExit, 'Desktop shutdown', 5000); }
    catch { child.kill('SIGKILL'); await childExit; }
  }
  await rm(root, { recursive: true, force: true });
}
