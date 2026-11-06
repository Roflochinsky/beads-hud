import { build } from 'esbuild';
import { glob, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const tests = [];
for await (const path of glob(['tests/**/*.test.ts', 'src/**/*.test.ts', 'dist/paseo/**/*.test.ts'])) tests.push(path);
if (!tests.length) throw new Error('No behavior tests found.');
await rm('.test-dist', { recursive: true, force: true });
await mkdir('.test-dist');
await build({ entryPoints: tests, outdir: '.test-dist', outbase: '.', bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['electron', '@getpaseo/plugin', 'react', 'react-native'], sourcemap: 'inline', logLevel: 'warning' });
const files = [];
for await (const path of glob('.test-dist/**/*.test.js')) files.push(path);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
