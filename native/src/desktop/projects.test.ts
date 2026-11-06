import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLaunchArgs } from './projects.js';

test('explicit project arguments are resolved from the caller, without using the working directory as a default', () => {
  assert.deepEqual(parseLaunchArgs([], '/tmp/caller').projectPaths, []);
  assert.deepEqual(
    parseLaunchArgs(['--project', 'alpha repo', '--project=/srv/beta', '--toggle'], '/tmp/caller'),
    { projectPaths: ['/tmp/caller/alpha repo', '/srv/beta'], toggle: true, quickCapture: false },
  );
});

test('a missing project value is rejected instead of treating the next option as a path', () => {
  assert.throws(() => parseLaunchArgs(['--project', '--toggle'], '/tmp/caller'), /--project requires/);
});
