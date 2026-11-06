import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from './http.js';

const { values } = parseArgs({ options: { project: { type: 'string', multiple: true }, port: { type: 'string' }, 'launch-file': { type: 'string' } } });
if (!values.project?.length) throw new Error('Supply --project /absolute/path (repeat for multiple projects).');
const projects = await Promise.all(values.project.map(async (directory) => {
  const path = await realpath(resolve(directory));
  return { id: path, name: basename(path), path };
}));
const port = values.port === undefined ? 0 : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535.');
const runtime = await startServer({ projects, port, staticDir: fileURLToPath(new URL('../ui', import.meta.url)) });
const file = values['launch-file'] ?? `${await mkdtemp(`${tmpdir()}/beads-board-`)}/launch.json`;
await writeFile(file, JSON.stringify({ url: `${runtime.url}/#token=${runtime.token}`, pid: process.pid }), { mode: 0o600, flag: 'wx' });
console.log(`Beads Board listening at ${runtime.url}. Authenticated launch link saved to ${file}`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => runtime.server.close(() => process.exit(0)));
