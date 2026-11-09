import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../public/beads-hud.js', import.meta.url), 'utf8')
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
test('workspace markup keeps unique IDs and every static JS hook', () => {
 assert.equal(new Set(ids).size, ids.length, 'duplicate ID')
 for (const [, id] of script.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `missing ${id}`)
})
test('workspace keeps all three task views and document editing controls', () => {
 for (const id of ['tv-board','tv-table','tv-graph','tab-docs','read','entry','task-move','task-shut','task-release','theme','project','mobile-nav']) assert.ok(ids.includes(id))
 assert.match(html, /aria-controls="workspace-nav" aria-expanded="false"/)
 assert.match(html, /href="\/workspace.css"/)
})

test('responsive navigation manages keyboard focus and closes safely', async () => {
 const { runInNewContext } = await import('node:vm')
 const classes = new Set()
 const doc = { activeElement: null, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn } }
 const node = (id, visible = true) => ({id, focus(){doc.activeElement=this}, getClientRects(){return visible ? [{}] : []}})
 const first = node('home'), project = node('project'), hidden = node('hidden-filter', false), last = node('theme')
 const controls = [first, project, hidden, last]
 const nav = {
  classList: { contains: key => classes.has(key), toggle(key, on) { on ? classes.add(key) : classes.delete(key) } },
  querySelectorAll: () => controls,
  contains: node => controls.includes(node),
 }
 const trigger = {...node('mobile-nav'), attrs: {}, setAttribute(k,v){this.attrs[k]=v}, getAttribute(k){return this.attrs[k]}, contains(n){return n===this}}
 const context = { document: doc, $: id => ({'workspace-nav':nav,'mobile-nav':trigger,project})[id] }
 const block = script.slice(script.indexOf('function setMobileNav'), script.indexOf('/* ── Views'))
 runInNewContext(block, context)
 context.setMobileNav(true)
 assert.equal(doc.activeElement, project)
 assert.equal(trigger.attrs['aria-expanded'], 'true')
 let prevented = false
 const press = (key, shiftKey = false) => { prevented = false;doc.handlers.keydown({key,shiftKey,preventDefault(){prevented=true}}) }
 last.focus();press('Tab');assert.equal(doc.activeElement, first);assert.equal(prevented,true)
 press('Tab',true);assert.equal(doc.activeElement,last);assert.equal(prevented,true)
 press('Escape');assert.equal(doc.activeElement,trigger);assert.equal(trigger.attrs['aria-expanded'],'false')
 context.setMobileNav(true);context.setMobileNav(false,{restoreFocus:false});assert.equal(doc.activeElement,project)
})
