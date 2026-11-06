import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { constants, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const expectedNames = new Set([
  `beads-board-${version}-linux-x86_64.AppImage`,
  `beads-board-${version}-linux-x64.tar.gz`,
  ...['x64', 'arm64'].flatMap((arch) => ['dmg', 'zip'].map((extension) => `beads-board-${version}-macos-${arch}.${extension}`)),
  ...['paseo', 'omarchy'].map((host) => `beads-${host}-${version}.tar.gz`),
]);
await mkdir('release', { recursive: true });
const sums = [];
const names = new Set();
for (const directory of await readdir('downloaded')) {
  const root = join('downloaded', directory);
  const manifest = await readFile(join(root, 'SHA256SUMS'), 'utf8');
  for (const line of manifest.trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
    if (!match || names.has(match[2])) throw new Error(`Invalid or duplicate artifact checksum entry in ${directory}.`);
    const [, expected, name] = match;
    if (!expectedNames.has(name)) throw new Error(`Unexpected release artifact: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(root, name))) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error(`Checksum mismatch: ${name}`);
    await copyFile(join(root, name), join('release', name), constants.COPYFILE_EXCL);
    names.add(name);
    sums.push(line);
  }
}
for (const name of expectedNames) if (!names.has(name)) throw new Error(`Missing release artifact: ${name}`);
await writeFile('release/SHA256SUMS', `${sums.sort().join('\n')}\n`);
console.log(`Verified ${names.size} release files.`);
