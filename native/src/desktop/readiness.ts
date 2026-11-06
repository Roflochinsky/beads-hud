import type { Snapshot } from '../shared.js';

export interface Readiness {
  ready: number;
  active: boolean;
  done: boolean;
  hasIssues: boolean;
  projectCount: number;
}

export type ReadinessState =
  | { kind: 'ready'; readiness: Readiness }
  | { kind: 'loading' }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string };

export function summarizeSnapshots(snapshots: readonly Snapshot[], now = Date.now()): Readiness {
  const recent = now - 7 * 24 * 60 * 60 * 1000;
  let ready = 0;
  let active = false;
  let done = false;
  let hasIssues = false;
  for (const snapshot of snapshots) {
    ready += snapshot.readyIds.length;
    hasIssues ||= snapshot.issues.length > 0;
    for (const issue of snapshot.issues) {
      active ||= issue.status === 'in_progress';
      if (!done && issue.status === 'closed' && issue.closedAt) {
        const closedAt = Date.parse(issue.closedAt);
        done = closedAt > recent && closedAt <= now;
      }
    }
  }
  return { ready, active, done, hasIssues, projectCount: snapshots.length };
}

function escapeMarkup(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function bead(glyph: string, lit: boolean): string {
  return lit ? glyph : `<span alpha="35%">${glyph}</span>`;
}

export function waybarOutput(state: ReadinessState): { text: string; tooltip: string; class: string[] } {
  if (state.kind !== 'ready') {
    const tooltip = state.kind === 'unconfigured'
      ? 'Beads: select a project with --project'
      : state.kind === 'loading' ? 'Beads: loading selected projects' : `Beads: ${escapeMarkup(state.message)}`;
    return { text: `${bead('●', false)} ${bead('◉', false)} ${bead('○', false)} ${state.kind === 'error' ? '!' : state.kind === 'loading' ? '…' : '–'}`, tooltip, class: ['beads', state.kind] };
  }
  const { ready, active, done, hasIssues, projectCount } = state.readiness;
  const text = `${bead('●', hasIssues && done)} ${bead('◉', hasIssues && active)} ${bead('○', hasIssues && ready > 0)} ${ready}`;
  return { text, tooltip: `Beads: ${ready} ready across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`, class: ['beads', ready > 0 ? 'ready' : 'idle'] };
}

/** One authoritative state, serialized for the requested native bar protocol. */
export function formatReadiness(state: ReadinessState, format: 'waybar' | 'omarchy'): string {
  return JSON.stringify(format === 'omarchy' ? state : waybarOutput(state));
}
