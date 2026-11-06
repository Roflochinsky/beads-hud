import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
if (!process.argv.includes('--checksums-only')) {
  for (const host of ['paseo', 'omarchy']) {
    const archive = `beads-${host}-${version}.tar.gz`;
    execFileSync('tar', ['-czf', join('release', archive), '-C', 'dist', host]);
  }
}
const sums = [];
const pluginArchives = new Set(['paseo', 'omarchy'].map((host) => `beads-${host}-${version}.tar.gz`));
for (const file of (await readdir('release')).filter((name) => pluginArchives.has(name) || (name.startsWith(`beads-board-${version}-`) && /\.(tar\.gz|AppImage|dmg|zip)$/.test(name))).sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join('release', file))) hash.update(chunk);
  sums.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile('release/SHA256SUMS', `${sums.join('\n')}\n`);
console.log(`Packaged ${sums.length} release assets with SHA256SUMS.`);
