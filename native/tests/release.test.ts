import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));

test('native release accepts its own version tag and rejects browser or mismatched tags', () => {
  for (const [tag, accepted] of [[`native-v${version}`, true], [`v${version}`, false], ['native-v0.0.0', false]] as const) {
    const result = spawnSync(process.execPath, ['scripts/check-version.mjs'], {
      env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status === 0, accepted, `${tag}: ${result.stdout}${result.stderr}`);
  }
});

test('release collection accepts exactly the native assets and rejects missing or foreign archives', async () => {
  const collect = resolve('scripts/collect-release.mjs');
  const files = [
    `beads-board-${version}-linux-x86_64.AppImage`,
    `beads-board-${version}-linux-x64.tar.gz`,
    `beads-board-${version}-macos-x64.dmg`,
    `beads-board-${version}-macos-x64.zip`,
    `beads-board-${version}-macos-arm64.dmg`,
    `beads-board-${version}-macos-arm64.zip`,
    `beads-tern-${version}.tar.gz`,
    `beads-paseo-${version}.tar.gz`,
    `beads-omarchy-${version}.tar.gz`,
  ];
  for (const scenario of ['complete', 'missing', 'foreign'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'beads-native-release-'));
    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({ version }));
      const directory = join(root, 'downloaded', 'beads-native-test');
      await mkdir(directory, { recursive: true });
      const assets = scenario === 'missing' ? files.slice(1) : [...files];
      if (scenario === 'foreign') assets.push(`beads-unrelated-${version}.tar.gz`);
      const sums = [];
      for (const file of assets) {
        const content = `Release contract fixture: ${file}\n`;
        await writeFile(join(directory, file), content);
        sums.push(`${createHash('sha256').update(content).digest('hex')}  ${file}`);
      }
      await writeFile(join(directory, 'SHA256SUMS'), `${sums.join('\n')}\n`);
      const result = spawnSync(process.execPath, [collect], { cwd: root, encoding: 'utf8' });
      assert.ifError(result.error);
      assert.equal(result.status === 0, scenario === 'complete', `${scenario}: ${result.stdout}${result.stderr}`);
      if (scenario === 'complete') {
        assert.deepEqual((await readdir(join(root, 'release'))).sort(), [...files, 'SHA256SUMS'].sort());
        assert.equal(await readFile(join(root, 'release', 'SHA256SUMS'), 'utf8'), `${sums.sort().join('\n')}\n`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
