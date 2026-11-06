--!strict
-- Tern 0.9.12: native host block; TypeScript owns all Beads command semantics.
local ui = tern.ui

type Issue = {
	id: string, title: string, description: string, status: string, priority: number,
	type: string, assignee: string, labels: { string }, dependencies: { { id: string, type: string } },
	notes: string?, acceptance: string?, design: string?,
}
type Snapshot = { issues: { Issue }, readyIds: { string }, blockedIds: { string }, fetchedAt: string }
type Field = { name: string, label: string, text: string, baseline: string, cursor: number }
type Form = { method: string, title: string, id: string?, fields: { Field }, focus: number }
type State = {
	cwd: string?, snapshot: Snapshot?, selected: string?, filter: string, layout: string,
	busy: boolean, error: string?, form: Form?, comments: string?,
}

local function props(node: Node, values: { [string]: any }): Node
	local p = node.p or {}
	for key, value in values do p[key] = value end
	node.p = p
	return node
end

local function running(cx: BlockCx): boolean
	for _, pane in tern.pane.list() do
		if pane.pane == cx.pane then return true end
	end
	return false
end

local function current(state: State): Issue?
	if state.snapshot then
		for _, issue in state.snapshot.issues do
			if issue.id == state.selected then return issue end
		end
	end
	return nil
end

local function statusGroup(snapshot: Snapshot, issue: Issue): string
	if issue.status == "closed" then return "closed" end
	if issue.status == "blocked" or table.find(snapshot.blockedIds, issue.id) ~= nil then return "blocked" end
	if issue.status == "in_progress" or issue.status == "deferred" or issue.status == "open" then return issue.status end
	return "other"
end

local function visible(state: State): { Issue }
	local result: { Issue } = {}
	local snapshot = state.snapshot
	if not snapshot then return result end
	for _, issue in snapshot.issues do
		if state.filter == "all"
			or (state.filter == "ready" and table.find(snapshot.readyIds, issue.id) ~= nil)
			or (state.filter == "active" and statusGroup(snapshot, issue) == "in_progress")
			or (state.filter == "blocked" and statusGroup(snapshot, issue) == "blocked") then
			table.insert(result, issue)
		end
	end
	table.sort(result, function(a, b)
		if a.priority == b.priority then return a.id < b.id end
		return a.priority < b.priority
	end)
	return result
end

local function request(state: State, cx: BlockCx, method: string, input: { [string]: any }?, done: (any) -> ())
	if state.busy or not running(cx) then return end
	if not state.cwd then
		state.error = "This block has no workspace directory. Open it beside a shell in a Beads project."
		return
	end
	state.busy = true
	local ok, err = pcall(function()
		tern.process.run({ tern.getenv("BEADS_TERN_NODE") or "node", tern.plugin.dir .. "/bridge.mjs" }, {
			cwd = state.cwd,
			stdin = tern.json.encode({ method = method, project = "workspace", input = input }),
			timeout_ms = 120000,
		}, function(result)
			if not running(cx) then return end
			state.busy = false
			local decoded, body = pcall(tern.json.decode, result.stdout)
			if decoded and type(body) == "table" and body.ok == true and result.status == 0 then
				state.error = nil
				done(body.result)
			else
				state.error = if decoded and type(body) == "table" and type(body.error) == "string" then body.error
					elseif result.timed_out then "Beads request timed out. Refresh before retrying a mutation; it may have completed."
					else "Beads bridge failed (exit " .. tostring(result.status) .. "): " .. result.stderr .. result.stdout
			end
			cx:render()
		end)
	end)
	if not ok then
		state.busy = false
		state.error = "Cannot start Beads bridge: " .. tostring(err)
	end
end

local function refresh(state: State, cx: BlockCx)
	request(state, cx, "snapshot", nil, function(snapshot)
		state.snapshot = snapshot
		if not current(state) then state.selected = nil end
	end)
end

local function mutate(state: State, cx: BlockCx, method: string, input: { [string]: any })
	request(state, cx, method, input, function(_result)
		state.form, state.comments = nil, nil
		cx:frame({ { "focus", tern.json.null } })
		refresh(state, cx)
	end)
end

-- Keep all cursor math in UTF-16, the public Tern input contract, not UTF-8 bytes.
local function length16(text: string): number
	local count = 0
	for _, cp in utf8.codes(text) do count += if cp > 65535 then 2 else 1 end
	return count
end

local function byteAt(text: string, offset: number): number
	local units = 0
	for pos, cp in utf8.codes(text) do
		local width = if cp > 65535 then 2 else 1
		if units + width > offset then return pos end
		units += width
	end
	return #text + 1
end

local function replace(field: Field, from: number, to: number, text: string)
	local start = byteAt(field.text, from)
	field.text = string.sub(field.text, 1, start - 1) .. text .. string.sub(field.text, byteAt(field.text, to))
	field.cursor = length16(string.sub(field.text, 1, start - 1)) + length16(text)
end

local function focusForm(state: State, cx: BlockCx)
	local form = state.form
	if form then
		cx:render()
		cx:frame({ { "focus", "main.form.f" .. tostring(form.focus) .. ".input" } })
	end
end

local function openForm(state: State, cx: BlockCx, method: string)
	local issue = current(state)
	if method ~= "create" and not issue then return end
	local fields: { Field } = {}
	local function field(name: string, label: string, value: string?)
		local text = value or ""
		table.insert(fields, { name = name, label = label, text = text, baseline = text, cursor = length16(text) })
	end
	if method == "create" or method == "update" then
		field("title", "Title", if method == "update" and issue then issue.title else "")
		field("description", "Description", if method == "update" and issue then issue.description else "")
		field("priority", "Priority (0–4)", if method == "update" and issue then tostring(issue.priority) else "2")
		field("assignee", "Assignee", if method == "update" and issue then issue.assignee else "")
		if method == "create" then
			field("type", "Type", "task")
			field("labels", "Labels (comma-separated)", "")
		elseif issue then
			field("status", "Status", issue.status)
			field("notes", "Notes", issue.notes)
			field("acceptance", "Acceptance criteria", issue.acceptance)
			field("design", "Design", issue.design)
		end
	elseif method == "link" or method == "unlink" then
		field("dependsOn", "Dependency issue ID", "")
		if method == "link" then field("type", "Dependency type", "blocks") end
	elseif method == "comment" then
		field("text", "Comment", "")
	elseif method == "close" then
		field("reason", "Closing reason (optional)", "")
	end
	local titles = { create = "New issue", update = "Edit issue", link = "Link dependency", unlink = "Unlink dependency", comment = "Add comment", close = "Close issue" }
	state.form = { method = method, title = titles[method] or method, id = if method == "create" then nil else (if issue then issue.id else nil), fields = fields, focus = 1 }
	focusForm(state, cx)
end

local function submit(state: State, cx: BlockCx)
	local form = state.form
	if not form or state.busy then return end
	local input: { [string]: any } = { id = form.id }
	local changed = false
	for _, field in form.fields do
		if form.method == "update" and field.text == field.baseline then continue end
		changed = true
		if field.name == "priority" then
			local priority = tonumber(field.text)
			if not priority or priority < 0 or priority > 4 or priority % 1 ~= 0 then
				state.error = "Priority must be an integer from 0 to 4."
				return
			end
			input.priority = priority
		elseif field.name == "labels" then
			local labels: { string } = {}
			for label in string.gmatch(field.text, "[^,]+") do
				local trimmed = string.match(label, "^%s*(.-)%s*$") or ""
				if trimmed ~= "" then table.insert(labels, trimmed) end
			end
			input.labels = tern.json.array(labels)
		else
			input[field.name] = field.text
		end
	end
	if form.method == "update" and not changed then
		state.form, state.error = nil, nil
		cx:frame({ { "focus", tern.json.null } })
		return
	end
	mutate(state, cx, form.method, input)
end

local function button(state: State, label: string, action: string, primary: boolean?): Node
	return ui.button(label, {
		actions = { click = action }, disabled = if state.busy then "Waiting for Beads" else false,
		variant = if primary then "primary" else "default",
	})
end

local function act(state: State, cx: BlockCx, action: string, value: string?)
	if state.busy then return end
	if action == "refresh" then refresh(state, cx)
	elseif action == "filter" and value then state.filter = value
	elseif action == "layout" then state.layout = if state.layout == "board" then "table" else "board"
	elseif action == "select-issue" and value then state.selected, state.comments = value, nil
	elseif action == "cancel" then state.form = nil; cx:frame({ { "focus", tern.json.null } })
	elseif action == "submit" then submit(state, cx)
	elseif action == "create" or action == "update" or action == "link" or action == "unlink" or action == "comment" or action == "close" then
		openForm(state, cx, action)
	elseif action == "claim" or action == "reclaim" or action == "reopen" then
		local issue = current(state)
		if issue then mutate(state, cx, action, { id = issue.id }) end
	elseif action == "comments" then
		local issue = current(state)
		if issue then request(state, cx, "comments", { id = issue.id }, function(result)
			state.comments = tern.json.encode(result, true)
		end) end
	end
end

local board: BlockDef<State> = {
	font = "sans",
	features = { "edit" },
	init = function(cx, _args, saved)
		local state: State = {
			cwd = cx.cwd, snapshot = nil, selected = nil, filter = "ready", layout = "board",
			busy = false, error = nil, form = nil, comments = nil,
		}
		if type(saved) == "table" then
			if saved.filter == "all" or saved.filter == "active" or saved.filter == "blocked" then state.filter = saved.filter end
			if saved.layout == "table" then state.layout = "table" end
		end
		refresh(state, cx)
		local function tick()
			if not running(cx) then return end
			if not state.busy and not state.form then refresh(state, cx) end
			tern.timer(5000, tick)
		end
		tern.timer(5000, tick)
		return state
	end,
	title = function(_state) return "Beads" end,
	save = function(state) return { filter = state.filter, layout = state.layout } end,
	view = function(state, cx)
		local children: { Node } = {
			ui.row({ ui.text({ ui.span("Beads", "title") }), button(state, "Refresh", "refresh"), button(state, "New issue", "create", true) }),
			ui.text({ ui.span(state.cwd or "No workspace", "mono muted") }),
		}
		local filters: { Node } = {}
		for _, item in { { "ready", "Ready" }, { "active", "Active" }, { "blocked", "Blocked" }, { "all", "All issues" } } do
			table.insert(filters, button(state, (if state.filter == item[1] then "[" .. item[2] .. "]" else item[2]), "filter=" .. item[1]))
		end
		table.insert(filters, button(state, if state.layout == "board" then "Table view" else "Board view", "layout"))
		table.insert(children, ui.row(filters))
		if state.error then table.insert(children, ui.text("Error: " .. state.error)) end
		if state.busy then table.insert(children, ui.text(if state.snapshot then "Updating…" else "Loading Beads…")) end
		local form = state.form
		if form then
			local controls: { Node } = { ui.text({ ui.span(form.title, "strong") }) }
			for i, field in form.fields do
				table.insert(controls, props(ui.col({
					ui.text(field.label),
					ui.node("editor", { key = "input", text = field.text, cursor = field.cursor, aria = field.label, maxLines = 4, readonly = state.busy }),
				}), { key = "f" .. tostring(i) }))
			end
			table.insert(controls, ui.row({ button(state, "Save", "submit", true), button(state, "Cancel", "cancel") }))
			table.insert(children, props(ui.col(controls), { key = "form", role = "beads-form" }))
		elseif state.snapshot then
			local issues = visible(state)
			if #issues == 0 then table.insert(children, ui.text("No issues in this view. Choose All issues or create an issue.")) end
			if state.layout == "table" then
				local rows = {}
				for _, issue in issues do
					table.insert(rows, { id = issue.id, cells = { issue.id, issue.title, "P" .. tostring(issue.priority), issue.status, issue.assignee } })
				end
				table.insert(children, props(ui.table({
					{ id = "id", head = "ID", mono = true, priority = 3 }, { id = "title", head = "Title", grow = 1, priority = 4 },
					{ id = "priority", head = "Priority", priority = 2 }, { id = "status", head = "Status", priority = 1 }, { id = "assignee", head = "Assignee", priority = 0 },
				}, rows, { selectable = not state.busy, selected = state.selected }), { key = "issues" }))
			else
				local columns: { Node } = {}
				for _, status in { "open", "in_progress", "blocked", "deferred", "closed", "other" } do
					local cards: { Node } = {}
					for _, issue in issues do
						if statusGroup(state.snapshot, issue) == status then
							local deps: { string } = {}
							for _, dep in issue.dependencies do table.insert(deps, dep.id .. " (" .. dep.type .. ")") end
							table.insert(cards, props(ui.card({ ui.span(issue.title, "strong") }, {
								ui.text({ ui.span(issue.id .. " · P" .. tostring(issue.priority), "mono") }),
								ui.text(if issue.assignee == "" then "Unassigned" else issue.assignee),
								ui.text(if #deps == 0 then "No dependencies" else table.concat(deps, ", ")),
							}), { key = issue.id, role = if state.selected == issue.id then "beads-selected" else "beads-issue", actions = { click = "select-issue=" .. issue.id } }))
						end
					end
					if #cards > 0 then table.insert(columns, props(ui.section((if status == "other" then "Other" else status) .. " · " .. tostring(#cards), cards), { key = status, role = "beads-column" })) end
				end
				table.insert(children, props(if cx.cols < 100 then ui.col(columns) else ui.row(columns), { key = "board", role = "beads-board" }))
			end
			local issue = current(state)
			if issue then
				local detail: { Node } = {
					ui.text({ ui.span(issue.id .. " · " .. issue.title, "strong") }),
					ui.text(issue.description),
					ui.text("Status: " .. issue.status),
					ui.kv({ { "Type", issue.type }, { "Priority", "P" .. tostring(issue.priority) }, { "Assignee", issue.assignee }, { "Labels", table.concat(issue.labels, ", ") } }),
					ui.row({ button(state, "Edit", "update"), button(state, "Claim", "claim"), button(state, "Reclaim", "reclaim"), button(state, if issue.status == "closed" then "Reopen" else "Close", if issue.status == "closed" then "reopen" else "close") }),
					ui.row({ button(state, "Link dependency", "link"), button(state, "Unlink dependency", "unlink"), button(state, "Add comment", "comment"), button(state, "Comments", "comments") }),
				}
				for _, dep in issue.dependencies do table.insert(detail, button(state, dep.id .. " · " .. dep.type, "select-issue=" .. dep.id)) end
				if issue.notes and issue.notes ~= "" then table.insert(detail, ui.text("Notes: " .. issue.notes)) end
				if issue.acceptance and issue.acceptance ~= "" then table.insert(detail, ui.text("Acceptance: " .. issue.acceptance)) end
				if issue.design and issue.design ~= "" then table.insert(detail, ui.text("Design: " .. issue.design)) end
				if state.comments then table.insert(detail, ui.code(state.comments, "json")) end
				table.insert(children, props(ui.section("Issue details", detail), { key = "detail" }))
			end
		end
		return {
			main = ui.col(children),
			dock = ui.col({ ui.text({ ui.span(if state.snapshot then "Fetched " .. state.snapshot.fetchedAt else "Waiting for workspace", "muted") }), ui.text("1 Ready · 2 Active · 3 Blocked · j/k Select · c Claim · x Close/reopen · n New · r Refresh · Ctrl Enter Save · Esc Cancel") }),
		}
	end,
	event = function(state, ev, cx)
		local form = state.form
		if form and ev.id then
			for i, field in form.fields do
				if ev.id == "main.form.f" .. tostring(i) .. ".input" then
					if ev.ev == "focus" then form.focus = i; focusForm(state, cx)
					elseif ev.ev == "edit" and not state.busy and ev.len == length16(field.text) then
						replace(field, ev.from, ev.to, ev.text)
						field.cursor = ev.cursor
					end
					return
				end
			end
		end
		if ev.ev == "action" then act(state, cx, ev.act, ev.value)
		elseif (ev.ev == "select" or ev.ev == "activate") and ev.id == "main.issues" then
			act(state, cx, "select-issue", ev.item)
		end
	end,
	key = function(state, key, cx)
		if state.busy then return false end
		local form = state.form
		if form then
			local field = form.fields[form.focus]
			if key.name == "escape" then act(state, cx, "cancel", nil)
			elseif key.name == "enter" and (key.ctrl or key.meta) then submit(state, cx)
			elseif key.name == "tab" then form.focus = (form.focus - 1 + (if key.shift then #form.fields - 1 else 1)) % #form.fields + 1; focusForm(state, cx)
			elseif key.name == "home" then field.cursor = 0
			elseif key.name == "end" then field.cursor = length16(field.text)
			elseif key.name == "left" or key.name == "backspace" then
				local pos = byteAt(field.text, field.cursor)
				local previous = if pos > 1 then (utf8.offset(field.text, -1, pos) or 1) else 1
				local offset = length16(string.sub(field.text, 1, previous - 1))
				if key.name == "backspace" then replace(field, offset, field.cursor, "") else field.cursor = offset end
			elseif key.name == "right" or key.name == "delete" then
				local pos = byteAt(field.text, field.cursor)
				local nextPos = if pos <= #field.text then (utf8.offset(field.text, 2, pos) or (#field.text + 1)) else (#field.text + 1)
				local offset = length16(string.sub(field.text, 1, nextPos - 1))
				if key.name == "delete" then replace(field, field.cursor, offset, "") else field.cursor = offset end
			elseif key.name == "enter" then replace(field, field.cursor, field.cursor, "\n")
			elseif key.text and not key.ctrl and not key.meta and not key.alt then replace(field, field.cursor, field.cursor, key.text)
			else return false end
			return true
		end
		if key.ctrl or key.meta or key.alt then return false end
		if key.name == "j" or key.name == "down" or key.name == "k" or key.name == "up" then
			local issues = visible(state)
			local index = 0
			for i, issue in issues do if issue.id == state.selected then index = i end end
			index = math.clamp(index + (if key.name == "k" or key.name == "up" then -1 else 1), 1, math.max(1, #issues))
			if issues[index] then state.selected, state.comments = issues[index].id, nil end
		elseif key.name == "1" then state.filter = "ready"
		elseif key.name == "2" then state.filter = "active"
		elseif key.name == "3" then state.filter = "blocked"
		elseif key.name == "r" then refresh(state, cx)
		elseif key.name == "n" then openForm(state, cx, "create")
		elseif key.name == "c" then act(state, cx, "claim", nil)
		elseif key.name == "x" then
			local issue = current(state)
			if issue then act(state, cx, if issue.status == "closed" then "reopen" else "close", nil) end
		elseif key.name == "escape" then state.selected, state.comments = nil, nil
		else return false end
		return true
	end,
}

tern.block.define("board", board)
