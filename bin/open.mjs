#!/usr/bin/env node
// Opens beads-hud in the browser. Under WSL that means the Windows browser,
// which reaches the server through WSL's localhost forwarding.
// `--wait` gives a just-spawned server a moment to write its run file.
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const runFile = join(homedir(), '.cache', 'beads-hud', 'server.json')

async function find() {
  try {
    const r = JSON.parse(await readFile(runFile, 'utf8'))
    process.kill(r.pid, 0)
    return r
  } catch {
    return null
  }
}

let run = await find()
if (!run && process.argv.includes('--wait')) {
  for (let i = 0; i < 20 && !run; i++) {
    await new Promise((r) => setTimeout(r, 250))
    run = await find()
  }
}

if (!run) {
  console.error('beads-hud не запущен. Запустите: node ' + join(import.meta.dirname, 'up.mjs'))
  process.exit(1)
}

// ponytail: try the openers in order, first one that exits 0 wins.
for (const [cmd, args] of [
  ['wslview', [run.url]],
  ['xdg-open', [run.url]],
  ['powershell.exe', ['-NoProfile', '-Command', 'Start-Process', run.url]],
]) {
  const ok = await new Promise((res) => execFile(cmd, args, (err) => res(!err)))
  if (ok) {
    console.log(run.url)
    process.exit(0)
  }
}
console.log(run.url)
console.error('Открыть браузер не удалось — скопируйте адрес выше.')
process.exit(1)
