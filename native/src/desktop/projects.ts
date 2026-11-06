import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Project } from '../shared.js';

export interface LaunchArgs {
  projectPaths: string[];
  toggle: boolean;
  quickCapture: boolean;
}

// argv is already stripped of Electron's executable and app entry point. Unknown
// arguments are left to Electron/Chromium (for example --ozone-platform=x11).
export function parseLaunchArgs(argv: readonly string[], cwd: string): LaunchArgs {
  const projectPaths: string[] = [];
  let toggle = false;
  let quickCapture = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project' || arg.startsWith('--project=')) {
      const value = arg === '--project' ? argv[++index] : arg.slice('--project='.length);
      if (!value || (arg === '--project' && value.startsWith('--'))) {
        throw new Error('--project requires a directory path');
      }
      projectPaths.push(resolve(cwd, value));
    } else if (arg === '--toggle') {
      toggle = true;
    } else if (arg === '--quick-capture') {
      quickCapture = true;
    }
  }
  return { projectPaths, toggle, quickCapture };
}

// Canonical paths keep aliases and repeated command-line options from showing
// the same project twice. The only projects authorized for IPC are these paths.
export async function projectsFromPaths(paths: readonly string[]): Promise<Project[]> {
  const projects: Project[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`Not a project directory: ${path}`);
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    projects.push({
      id: createHash('sha256').update(canonical).digest('hex'),
      name: basename(canonical) || canonical,
      path: canonical,
    });
  }
  return projects;
}
