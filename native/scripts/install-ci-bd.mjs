import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const assets = {
  'linux-x64': ['linux_amd64', 'c6ea3281f6ff82628351b2d0967c9eb85862c8a0ec0ebc24e63e645c8b02462e'],
  'linux-arm64': ['linux_arm64', '39b34a1246b7216031a98ae838c785a7dbba29cf9f50f109114ac462a4b85e7c'],
  'darwin-x64': ['darwin_amd64', '255ac728729fdf431c3dd0d23ac03cce6d51998cc88a883ec8bc7be9323b0b05'],
  'darwin-arm64': ['darwin_arm64', 'b29b44499d11944bb5cecdd60b49eaf1481f4c3fe031ab45a2df1a36dadb8445'],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('Unsupported CI platform for pinned Beads 1.3.2.');
const directory = await mkdtemp(join(tmpdir(), 'beads-ci-'));
const response = await fetch(`https://github.com/gastownhall/beads/releases/download/v1.3.2/beads_1.3.2_${asset[0]}.tar.gz`);
if (!response.ok) throw new Error(`Beads download failed: ${response.status}`);
const content = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(content).digest('hex') !== asset[1]) throw new Error('Beads archive SHA256 mismatch.');
const archive = join(directory, 'bd.tar.gz');
await writeFile(archive, content);
execFileSync('tar', ['-xzf', archive, '-C', directory]);
await chmod(join(directory, 'bd'), 0o755);
execFileSync(join(directory, 'bd'), ['--version'], { stdio: 'inherit' });
if (process.env.GITHUB_PATH) await appendFile(process.env.GITHUB_PATH, `${directory}\n`);
else console.log(`Add ${directory} to PATH to use this isolated CI installation.`);
