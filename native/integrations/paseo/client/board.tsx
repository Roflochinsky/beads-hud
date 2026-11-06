import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import { beadsRpc, projectSchema, snapshotSchema } from "../shared/rpc.js";
import type { BeadsRequest, Issue } from "../shared/rpc.js";
import { Button, Choices, Field, Notice, colors, styles } from "./components.js";

const statuses = ["open", "in_progress", "blocked", "deferred", "closed"] as const;
const types = ["task", "bug", "feature", "epic", "chore", "decision", "spike", "story", "milestone"] as const;
const priorities = ["0", "1", "2", "3", "4"] as const;
const commentSchema = z.object({ id: z.string(), author: z.string(), text: z.string(), created_at: z.string() });
type Change = { method: BeadsRequest["method"]; input: Record<string, unknown> };
type RunChange = (change: Change, onSuccess?: () => void) => void;

export function BeadsPanel(props: PluginWorkspacePanelProps) {
  return <Board hostId={props.host.id} workspaceId={props.workspaceId} compact={props.layout.compact} />;
}
export function BeadsScreen(props: PluginScreenProps) {
  return <Board hostId={props.host.id} compact={props.layout.compact} />;
}

function Board({ hostId, workspaceId, compact }: { hostId: string; workspaceId?: string; compact: boolean }) {
  const rpc = useRpc(beadsRpc);
  const cache = useQueryClient();
  const [chosen, setChosen] = useState("");
  const [selected, setSelected] = useState<{ hostId: string; project: string; issue: Issue } | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState("Board");
  const projects = useQuery({ queryKey: ["beads", hostId, "projects"],
    queryFn: async () => projectSchema.array().parse(await rpc({ method: "projects" })),
    refetchInterval: 30_000, retry: false });
  useEffect(() => {
    const first = projects.data?.[0];
    if (!workspaceId && first) {
      setChosen((current) => current || first.id);
    }
  }, [workspaceId, projects.data]);
  const project = workspaceId ?? (chosen || undefined);
  const projectMissing = !workspaceId && Boolean(chosen) && projects.data !== undefined
    && !projects.data.some((item) => item.id === chosen);
  const snapshotKey = ["beads", hostId, project, "snapshot"];
  const snapshot = useQuery({ queryKey: snapshotKey, enabled: Boolean(project) && !projectMissing,
    queryFn: async () => snapshotSchema.parse(await rpc({ method: "snapshot", project })),
    refetchInterval: 10_000, refetchIntervalInBackground: false, retry: false });
  const change = useMutation({
    mutationFn: (value: Change) => rpc({ ...value, project }),
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: snapshotKey }),
        cache.invalidateQueries({ queryKey: ["beads", hostId, project, "comments"] }),
      ]);
    },
  });
  const run: RunChange = (value, onSuccess) => change.mutate(value, { onSuccess });
  const data = snapshot.data;
  const selection = selected?.hostId === hostId && selected.project === project ? selected.issue : null;
  const liveIssue = data?.issues.find((item) => item.id === selection?.id);
  const issue = liveIssue ?? selection;
  const issueMissing = Boolean(selection && data && !liveIssue);
  const needle = search.trim().toLowerCase();
  const groupOf = (item: Issue): string => {
    if (item.status === "closed") return "Closed";
    if (item.status === "blocked" || data?.blockedIds.includes(item.id)) return "Blocked";
    if (item.status === "deferred") return "Backlog";
    if (item.status === "in_progress") return "In progress";
    if (data?.readyIds.includes(item.id)) return "Ready";
    return "Backlog";
  };
  const visible = data?.issues.filter((item) => {
    const matches = !needle || [item.id, item.title, item.description, item.assignee, ...item.labels].join(" ").toLowerCase().includes(needle);
    return matches && (filter === "All" || (filter === "Ready" || filter === "Blocked"
      ? groupOf(item) === filter : item.status === filter));
  }) ?? [];
  const groups = ["Ready", "In progress", "Blocked", "Backlog", "Closed"].map((name) => ({
    name, items: visible.filter((item) => groupOf(item) === name),
  }));
  const pending = change.isPending;
  const mutationsDisabled = pending || projectMissing;
  return <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={[styles.row, { justifyContent: "space-between" }]}>
      <View><Text accessibilityRole="header" style={styles.heading}>Beads</Text>
        <Text style={styles.caption}>{data?.project.name ?? "Workspace issues"}</Text></View>
      <View style={styles.row}>
        <Button disabled={!project || mutationsDisabled} primary onPress={() => { setCreating(true); setSelected(null); change.reset(); }}>New issue</Button>
        <Button disabled={snapshot.isFetching || projects.isFetching || pending} onPress={() => {
          void projects.refetch(); if (project && !projectMissing) void snapshot.refetch();
        }}>Refresh</Button>
      </View>
    </View>
    {!workspaceId && projects.data && <View style={styles.row}>{projects.data.map((item) =>
      <Button key={item.id} selected={item.id === project} disabled={pending} onPress={() => {
        setChosen(item.id); setSelected(null); setCreating(false); change.reset();
      }}>{item.name}</Button>)}</View>}
    {projects.isPending && <Notice>Loading Paseo workspaces…</Notice>}
    {projects.error && <Notice error>{projects.error.message}</Notice>}
    {projects.data?.length === 0 && <Notice>Open a workspace in Paseo, initialize Beads there with bd init, then refresh.</Notice>}
    {projectMissing && <Notice error>The selected workspace is no longer available. Your draft is retained while you refresh; choosing another workspace discards it.</Notice>}
    {snapshot.isPending && project && !projectMissing && <Notice>Loading Beads issues…</Notice>}
    {snapshot.error && <Notice error>{snapshot.error.message} Check that bd is installed on the daemon host and this workspace has been initialized, then refresh.</Notice>}
    {change.error && <Notice error>{change.error.message}</Notice>}
    {pending && <Notice>Saving and refreshing authoritative Beads data…</Notice>}
    {creating && project && <IssueForm key={project} pending={mutationsDisabled} run={run} onCancel={() => setCreating(false)} />}
    {issue && project && <IssueDetail key={`${project}:${issue.id}`} issue={issue} allIssues={data?.issues ?? []}
      hostId={hostId} project={project} pending={mutationsDisabled || issueMissing} run={run} onClose={() => setSelected(null)} />}
    {issueMissing && <><Notice error>This issue is no longer in the workspace snapshot. Your draft is retained but cannot be saved; refresh or dismiss it.</Notice>
      <Button disabled={pending} onPress={() => setSelected(null)}>Dismiss unavailable issue</Button></>}
    {data && <>
      <Field label="Search title, ID, description, assignee or label" value={search} onChange={setSearch} />
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Choices label="Filter" choices={["All", "Ready", "Blocked", ...statuses]} value={filter} onChange={setFilter} />
        <Choices label="View" choices={["Board", "Table"]} value={view} onChange={setView} />
      </View>
      <Text style={styles.caption}>{visible.length} issues · {data.issues.filter((item) => groupOf(item) === "Ready").length} ready · {data.issues.filter((item) => groupOf(item) === "Blocked").length} blocked · Updated {data.fetchedAt}</Text>
      {data.issues.length === 0 ? <Notice>No issues yet. Create an issue to start tracking this workspace.</Notice>
        : visible.length === 0 ? <Notice>No issues match these filters.</Notice>
        : view === "Table" ? <View style={styles.section}>{visible.map((item) =>
          <IssueRow key={item.id} issue={item} selected={selection?.id === item.id} compact={compact} disabled={mutationsDisabled} onPress={() => { if (project) { setSelected({ hostId, project, issue: item }); setCreating(false); change.reset(); } }} />)}</View>
        : <ScrollView horizontal={!compact} contentContainerStyle={{ gap: 16, flexDirection: compact ? "column" : "row" }}>
          {groups.map((group) => <View key={group.name} style={{ width: compact ? "100%" : 280, gap: 8 }}>
            <Text accessibilityRole="header" style={styles.heading}>{group.name} · {group.items.length}</Text>
            {group.items.length === 0 && <Text style={styles.caption}>No issues</Text>}
            {group.items.map((item) => <IssueRow key={item.id} issue={item} selected={selection?.id === item.id} compact disabled={mutationsDisabled} onPress={() => { if (project) { setSelected({ hostId, project, issue: item }); setCreating(false); change.reset(); } }} />)}
          </View>)}
        </ScrollView>}
    </>}
  </ScrollView>;
}

function IssueRow({ issue, selected, compact, disabled, onPress }: { issue: Issue; selected: boolean; compact: boolean; disabled: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${issue.id}: ${issue.title}`} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.card, { flexDirection: compact ? "column" : "row", backgroundColor: selected || pressed ? colors.wash : colors.surface, opacity: disabled ? 0.6 : 1 }]}>
    <Text style={styles.caption}>{issue.id} · P{issue.priority} · {issue.type}</Text>
    <Text style={[styles.text, !compact && { flex: 1 }]}>{issue.title}</Text>
    <Text style={styles.caption}>{issue.status} · {issue.assignee || "Unassigned"}</Text>
    {issue.dependencies.length > 0 && <Text style={styles.caption}>{issue.dependencies.map((dep) => `${dep.type}: ${dep.id}`).join(" · ")}</Text>}
    {issue.labels.length > 0 && <Text style={styles.caption}>{issue.labels.join(" · ")}</Text>}
  </Pressable>;
}

function IssueForm({ issue, pending, run, onCancel }: { issue?: Issue; pending: boolean; run: RunChange; onCancel(): void }) {
  const [initial] = useState(() => ({
    title: issue?.title ?? "", description: issue?.description ?? "", priority: String(issue?.priority ?? 2),
    assignee: issue?.assignee ?? "", status: issue?.status ?? "open", notes: issue?.notes ?? "",
    acceptance: issue?.acceptance ?? "", design: issue?.design ?? "",
  }));
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [priority, setPriority] = useState(initial.priority);
  const [type, setType] = useState(issue?.type ?? "task");
  const [assignee, setAssignee] = useState(initial.assignee);
  const [status, setStatus] = useState(initial.status);
  const [labels, setLabels] = useState("");
  const [notes, setNotes] = useState(initial.notes);
  const [acceptance, setAcceptance] = useState(initial.acceptance);
  const [design, setDesign] = useState(initial.design);
  const values = { title, description, priority, assignee, status, notes, acceptance, design };
  const changes: Record<string, unknown> = {};
  for (const field of Object.keys(values) as Array<keyof typeof values>) {
    if (values[field] !== initial[field]) {
      changes[field] = field === "title" ? title.trim() : field === "priority" ? Number(priority) : values[field];
    }
  }
  const editFlags = Object.entries(changes).map(([field, value]) => `--${field}=${JSON.stringify(String(value))}`).join(" ");
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>{issue ? `Edit ${issue.id}` : "New issue"}</Text>
    <Field label="Title" value={title} onChange={setTitle} disabled={pending} />
    <Field label="Description" value={description} onChange={setDescription} multiline disabled={pending} />
    <Choices label="Priority (P0 highest)" choices={priorities} value={priority} onChange={setPriority} disabled={pending} />
    <Field label="Assignee" value={assignee} onChange={setAssignee} disabled={pending} />
    {!issue ? <>
      <Choices label="Type" choices={types} value={type} onChange={setType} disabled={pending} />
      <Field label="Labels (comma separated)" value={labels} onChange={setLabels} disabled={pending} />
    </> : <>
      <Choices label="Status" choices={statuses} value={status} onChange={setStatus} disabled={pending} />
      <Field label="Notes" value={notes} onChange={setNotes} multiline disabled={pending} />
      <Field label="Acceptance criteria" value={acceptance} onChange={setAcceptance} multiline disabled={pending} />
      <Field label="Design" value={design} onChange={setDesign} multiline disabled={pending} />
    </>}
    <Text selectable style={styles.caption}>Command: {issue
      ? editFlags ? `bd update ${editFlags} -- ${JSON.stringify(issue.id)}` : "No changes to save"
      : `bd create --title ${JSON.stringify(title)} --priority ${priority}`}</Text>
    <View style={styles.row}>
      <Button primary disabled={pending || !title.trim() || Boolean(issue && !Object.keys(changes).length)} onPress={() => run({
        method: issue ? "update" : "create",
        input: issue ? { id: issue.id, ...changes } : {
          title: title.trim(), description, priority: Number(priority), assignee, type,
          labels: labels.split(",").map((label) => label.trim()).filter(Boolean),
        },
      }, onCancel)}>{issue ? "Save changes" : "Create issue"}</Button>
      <Button disabled={pending} onPress={onCancel}>Cancel</Button>
    </View>
  </View>;
}

function IssueDetail({ issue, allIssues, hostId, project, pending, run, onClose }: {
  issue: Issue; allIssues: Issue[]; hostId: string; project: string; pending: boolean; run: RunChange; onClose(): void;
}) {
  const rpc = useRpc(beadsRpc);
  const [editing, setEditing] = useState(false);
  const [dependsOn, setDependsOn] = useState("");
  const [relation, setRelation] = useState("blocks");
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const comments = useQuery({ queryKey: ["beads", hostId, project, "comments", issue.id],
    queryFn: async () => commentSchema.array().parse(await rpc({ method: "comments", project, input: { id: issue.id } })), retry: false });
  const dependents = allIssues.filter((item) => item.dependencies.some((dep) => dep.id === issue.id));
  if (editing) return <IssueForm issue={issue} pending={pending} run={run} onCancel={() => setEditing(false)} />;
  return <View style={styles.section}>
    <View style={[styles.row, { justifyContent: "space-between" }]}>
      <Text accessibilityRole="header" style={styles.heading}>{issue.id} · {issue.title}</Text>
      <Button disabled={pending} onPress={onClose}>Dismiss detail</Button>
    </View>
    <Text style={styles.caption}>{issue.status} · P{issue.priority} · {issue.type} · {issue.assignee || "Unassigned"}</Text>
    <Text selectable style={styles.text}>{issue.description || "No description."}</Text>
    {([ ["Notes", issue.notes], ["Acceptance criteria", issue.acceptance], ["Design", issue.design],
      ["Due", issue.dueAt], ["Deferred until", issue.deferUntil], ["Heartbeat", issue.heartbeatAt] ] as const).map(([label, value]) => value
      ? <View key={label}><Text style={styles.caption}>{label}</Text><Text selectable style={styles.text}>{value}</Text></View> : null)}
    <Text style={styles.caption}>Created {issue.createdAt} · Updated {issue.updatedAt}{issue.closedAt ? ` · Closed ${issue.closedAt}` : ""}</Text>
    <View style={styles.row}>
      <Button disabled={pending} onPress={() => setEditing(true)}>Edit issue</Button>
      <Button disabled={pending || issue.status === "closed"} onPress={() => run({ method: "claim", input: { id: issue.id } })}>Claim</Button>
      <Button disabled={pending || issue.status === "closed"} onPress={() => run({ method: "reclaim", input: { id: issue.id } })}>Reclaim stale lease</Button>
    </View>
    <Field label="Close reason (optional)" value={reason} onChange={setReason} disabled={pending} />
    <Text selectable style={styles.caption}>Command: bd {issue.status === "closed" ? "reopen" : "close"} {issue.id}</Text>
    <Button disabled={pending} onPress={() => run({ method: issue.status === "closed" ? "reopen" : "close", input: { id: issue.id, ...(reason && issue.status !== "closed" ? { reason } : {}) } })}>{issue.status === "closed" ? "Reopen issue" : "Close issue"}</Button>
    <Text accessibilityRole="header" style={styles.heading}>Dependencies</Text>
    {issue.dependencies.length === 0 && <Text style={styles.caption}>No dependencies.</Text>}
    {issue.dependencies.map((dep) => <View style={styles.row} key={`${dep.id}:${dep.type}`}>
      <Text style={styles.text}>{dep.type}: {dep.id} {allIssues.find((item) => item.id === dep.id)?.title ?? ""}</Text>
      <Button disabled={pending} onPress={() => run({ method: "unlink", input: { id: issue.id, dependsOn: dep.id } })}>{`Unlink ${dep.id}`}</Button>
    </View>)}
    {dependents.length > 0 && <Text style={styles.text}>Dependents: {dependents.map((item) => `${item.id} ${item.title}`).join(" · ")}</Text>}
    <Field label="Dependency issue ID" value={dependsOn} onChange={setDependsOn} disabled={pending} />
    <Choices label="Relationship" choices={["blocks", "parent-child", "related", "discovered-from"]} value={relation} onChange={setRelation} disabled={pending} />
    <Text selectable style={styles.caption}>Command: bd dep add {issue.id} {dependsOn || "<dependency-id>"} --type {relation}</Text>
    <Button disabled={pending || !dependsOn.trim() || dependsOn.trim() === issue.id} onPress={() => run({ method: "link", input: { id: issue.id, dependsOn: dependsOn.trim(), type: relation } }, () => setDependsOn(""))}>Link dependency</Button>
    <Text accessibilityRole="header" style={styles.heading}>Comments</Text>
    {comments.isPending && <Text style={styles.caption}>Loading comments…</Text>}
    {comments.error && <Notice error>{comments.error.message}</Notice>}
    {comments.data?.length === 0 && <Text style={styles.caption}>No comments yet.</Text>}
    {comments.data?.map((entry) => <View key={entry.id} style={{ gap: 4 }}>
      <Text style={styles.caption}>{entry.author} · {new Date(entry.created_at).toLocaleString()}</Text>
      <Text selectable style={styles.text}>{entry.text}</Text>
    </View>)}
    <Field label="New comment" value={comment} onChange={setComment} multiline disabled={pending} />
    <Button disabled={pending || !comment.trim()} onPress={() => run({ method: "comment", input: { id: issue.id, text: comment.trim() } }, () => setComment(""))}>Add comment</Button>
  </View>;
}
