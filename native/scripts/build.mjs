import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const node = { bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: true, external: ['electron'], logLevel: 'info' };
await build({ entryPoints: ['src/ui/entry.ts'], outdir: 'dist/ui', bundle: true, platform: 'browser', target: 'es2022', format: 'esm', sourcemap: true, loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]-[hash]', logLevel: 'info' });
const html = (script, css) => `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beads Board</title><link rel="stylesheet" href="${css}"></head><body><div id="app"></div><script type="module" src="${script}"></script></body></html>\n`;
await writeFile('dist/ui/index.html', html('./entry.js', './entry.css'));
await mkdir('dist/ui/licenses', { recursive: true });
await cp('src/ui/THIRD-PARTY.md', 'dist/ui/THIRD-PARTY.md');
await cp('src/ui/fonts/OFL.txt', 'dist/ui/licenses/Onest-OFL.txt');
await cp('src/ui/icons/LICENSE', 'dist/ui/licenses/Material-Symbols-LICENSE');
await cp('integrations/paseo', 'dist/paseo', { recursive: true });
await cp('integrations/omarchy', 'dist/omarchy', { recursive: true });
for (const host of ['ui', 'paseo', 'omarchy']) await cp('LICENSE', `dist/${host}/LICENSE`);
await mkdir('dist/desktop', { recursive: true });
async function copyStatic(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) { await mkdir(join(destination, entry.name), { recursive: true }); await copyStatic(join(source, entry.name), join(destination, entry.name)); }
    else if (!/\.[cm]?tsx?$/.test(entry.name)) await cp(join(source, entry.name), join(destination, entry.name));
  }
}
await copyStatic('src/desktop', 'dist/desktop');
await Promise.all([
  build({ ...node, entryPoints: ['src/core/service.ts'], outfile: 'dist/paseo/server/core.js' }),
  build({ ...node, entryPoints: ['src/desktop/main.ts', 'src/desktop/waybar.ts'], outdir: 'dist/desktop' }),
  build({ ...node, entryPoints: ['src/desktop/preload.ts'], outfile: 'dist/desktop/preload.cjs', format: 'cjs' }),
  build({ ...node, entryPoints: ['src/server/main.ts'], outfile: 'dist/server/main.js' }),
]);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const paseoPackage = JSON.parse(await readFile('dist/paseo/package.json', 'utf8'));
paseoPackage.version = pkg.version;
await writeFile('dist/paseo/package.json', `${JSON.stringify(paseoPackage, null, 2)}\n`);
console.log(`Built Beads Board ${pkg.version} for all hosts.`);
