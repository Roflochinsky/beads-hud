#!/usr/bin/env node
// Starts beads-hud unless it is already up. One server serves every project,
// so this is a no-op in every session after the first.
// Meant for the Claude Code SessionStart hook: quiet, instant, idempotent.
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const runFile = join(homedir(), '.cache', 'beads-hud', 'server.json')

const alive = await readFile(runFile, 'utf8')
  .then((t) => {
    const r = JSON.parse(t)
    process.kill(r.pid, 0) // throws when the pid is gone
    return r
  })
  .catch(() => null)

if (!alive) {
  const here = dirname(fileURLToPath(import.meta.url))
  // cwd becomes the project the board opens on first.
  spawn(process.execPath, [join(here, '..', 'server.mjs')], { cwd: resolve(process.cwd()), detached: true, stdio: 'ignore' }).unref()
  if (!process.env.BEADS_HUD_NO_OPEN) {
    spawn(process.execPath, [join(here, 'open.mjs'), '--wait'], { detached: true, stdio: 'ignore' }).unref()
  }
}
