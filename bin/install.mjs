// Прописывает beads-hud в настройки Claude Code — строку статуса и хук автозапуска.
//
// Отдельной командой, а не postinstall: пакет, который лезет в конфиг чужого
// инструмента при установке и при каждом обновлении, делает это молча и в тот
// момент, когда человек об этом не думает. Здесь всё наоборот — команду зовут
// руками, она показывает, что изменит, и кладёт рядом копию прежнего файла.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const STATUSLINE = 'beads-hud-statusline'
const UP = 'beads-hud-up'

const ours = (c) => typeof c === 'string' && c.includes('beads-hud')

const settingsPath = (project) =>
  project ? join(process.cwd(), '.claude', 'settings.json') : join(homedir(), '.claude', 'settings.json')

async function read(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { data: {}, existed: false }
  }
  try {
    return { data: JSON.parse(raw), existed: true }
  } catch (e) {
    throw new Error(`${path} — не читается как JSON: ${e.message}\nПоправьте файл руками, я не буду его перезаписывать.`)
  }
}

/** Группа хуков с пустым фильтром — та, куда Claude Code складывает общие хуки. */
function sessionGroup(data) {
  data.hooks ||= {}
  data.hooks.SessionStart ||= []
  let group = data.hooks.SessionStart.find((g) => (g.matcher ?? '') === '')
  if (!group) {
    group = { matcher: '', hooks: [] }
    data.hooks.SessionStart.push(group)
  }
  group.hooks ||= []
  return group
}

async function backup(path) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const to = `${path}.bak-${stamp}`
  await copyFile(path, to)
  return to
}

export async function install({ project = false, force = false, dryRun = false } = {}) {
  const path = settingsPath(project)
  const { data, existed } = await read(path)

  const had = data.statusLine?.command
  // Строка статуса в Claude Code одна. Чужую молча не забираем.
  if (had && !ours(had) && !force) {
    console.error(`Строка статуса уже занята: ${had}`)
    console.error(`Файл: ${path}`)
    console.error('Если её правда надо заменить — повторите с --force. Прежний файл я всё равно сохраню копией.')
    return 1
  }

  const group = sessionGroup(data)
  const hasHook = group.hooks.some((h) => ours(h.command))
  const hasLine = had === STATUSLINE

  if (hasLine && hasHook) {
    console.log(`Уже настроено: ${path}`)
    console.log('Ничего не меняю.')
    return 0
  }

  const plan = []
  if (!hasLine) plan.push(`  statusLine.command: ${had ? `${had} → ${STATUSLINE}` : STATUSLINE}`)
  if (!hasHook) plan.push(`  hooks.SessionStart: + ${UP} (timeout 10)`)

  console.log(`${existed ? 'Правлю' : 'Создаю'}: ${path}`)
  console.log(plan.join('\n'))

  if (dryRun) {
    console.log('\n--dry-run: ничего не записано.')
    return 0
  }

  data.statusLine = { type: 'command', command: STATUSLINE }
  if (!hasHook) group.hooks.push({ type: 'command', command: UP, timeout: 10 })

  if (existed) console.log(`Копия прежнего файла: ${await backup(path)}`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')

  console.log('\nГотово. Строка появится в следующей сессии Claude Code — настройки читаются при старте.')
  console.log('Проверить прямо сейчас:')
  console.log(`  echo '{"model":{"display_name":"Opus 5"},"context_window":{"used_percentage":10},"cost":{"total_cost_usd":0},"cwd":"'"$PWD"'"}' | ${STATUSLINE}`)
  return 0
}

export async function uninstall({ project = false, dryRun = false } = {}) {
  const path = settingsPath(project)
  const { data, existed } = await read(path)
  if (!existed) {
    console.log(`Файла нет: ${path}. Убирать нечего.`)
    return 0
  }

  const plan = []
  if (ours(data.statusLine?.command)) plan.push('  statusLine: убрать')
  const groups = data.hooks?.SessionStart || []
  if (groups.some((g) => (g.hooks || []).some((h) => ours(h.command)))) plan.push(`  hooks.SessionStart: убрать ${UP}`)

  if (!plan.length) {
    console.log(`В ${path} настроек beads-hud нет.`)
    return 0
  }

  console.log(`Правлю: ${path}`)
  console.log(plan.join('\n'))
  if (dryRun) {
    console.log('\n--dry-run: ничего не записано.')
    return 0
  }

  if (ours(data.statusLine?.command)) delete data.statusLine
  for (const g of groups) g.hooks = (g.hooks || []).filter((h) => !ours(h.command))
  // Пустые оболочки за собой убираем, чтобы файл не зарастал.
  data.hooks.SessionStart = groups.filter((g) => (g.hooks || []).length)
  if (!data.hooks.SessionStart.length) delete data.hooks.SessionStart
  if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks

  console.log(`Копия прежнего файла: ${await backup(path)}`)
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log('\nГотово. Строка исчезнет в следующей сессии.')
  return 0
}
