import { basename } from 'node:path';
import { handleRequest } from '../core/service.js';
import type { RpcRequest } from '../shared.js';

// Tern supplies cwd through process.run, never through the RPC payload.
// One stdin document / one stdout envelope keeps Luau independent of bd's JSON dialect.
try {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += String(chunk);
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('method' in value)
      || typeof value.method !== 'string') throw new Error('Request requires a method');
  if ('project' in value && value.project !== 'workspace') throw new Error('Unknown project: only workspace is allowed');
  if ('input' in value && (!value.input || typeof value.input !== 'object' || Array.isArray(value.input))) {
    throw new Error('Request input must be an object');
  }
  const request: RpcRequest = { method: value.method, project: 'workspace' };
  if ('input' in value) request.input = value.input as Record<string, unknown>;
  const cwd = process.cwd();
  const result = await handleRequest(request, [{ id: 'workspace', name: basename(cwd) || cwd, path: cwd }]);
  process.stdout.write(JSON.stringify({ ok: true, result: result ?? null }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
