import { loadReadiness } from './load-readiness.js';
import { parseLaunchArgs, projectsFromPaths } from './projects.js';
import { formatReadiness, type ReadinessState } from './readiness.js';

let state: ReadinessState;
try {
  const { projectPaths } = parseLaunchArgs(process.argv.slice(2), process.cwd());
  state = await loadReadiness(await projectsFromPaths(projectPaths));
} catch (error) {
  state = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
}
const format = process.argv.slice(2).includes('--format=omarchy') ? 'omarchy' : 'waybar';
process.stdout.write(`${formatReadiness(state, format)}\n`);
