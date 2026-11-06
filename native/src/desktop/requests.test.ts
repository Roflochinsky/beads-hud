import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeDesktopRequest, assertTrustedDocument } from './requests.js';
import type { Project } from '../shared.js';

const projects: Project[] = [{ id: 'allowed', name: 'Work', path: '/work' }];

test('the desktop bridge only accepts its own main document', () => {
  assert.doesNotThrow(() => assertTrustedDocument(true, 'beads://app/index.html?mode=tray', 'beads://app/index.html'));
  assert.throws(() => assertTrustedDocument(false, 'beads://app/index.html', 'beads://app/index.html'));
  assert.throws(() => assertTrustedDocument(true, 'https://app/index.html', 'beads://app/index.html'));
  assert.throws(() => assertTrustedDocument(true, 'beads://other/index.html', 'beads://app/index.html'));
});

test('the desktop bridge authorizes only shared RPC methods on selected projects', () => {
  assert.deepEqual(authorizeDesktopRequest({ method: 'snapshot', project: 'allowed' }, projects), { method: 'snapshot', project: 'allowed' });
  assert.throws(() => authorizeDesktopRequest({ method: 'snapshot', project: '/etc' }, projects));
  assert.throws(() => authorizeDesktopRequest({ method: 'exec', project: 'allowed', input: { command: 'id' } }, projects));
  assert.throws(() => authorizeDesktopRequest({ method: 'create', project: 'allowed', input: { title: 'Task', command: 'id' } }, projects));
});
