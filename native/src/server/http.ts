import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { handleRequest } from '../core/service.js';
import type { Project, RpcRequest } from '../shared.js';

// Largest shared input is create: 100 labels + title/description/type/assignee,
// each <= 64 KiB UTF-8. JSON can expand each byte to six (\u00XX); 40 MiB
// covers those 104 strings (39 MiB) plus the RPC envelope. Decoded field limits
// are still enforced by the core; authentication precedes all body buffering.
const REQUEST_BODY_LIMIT = 40 * 1024 * 1024;

export async function startServer(options: { projects: Project[]; staticDir: string; port?: number }): Promise<{ server: Server; url: string; token: string }> {
  const token = randomBytes(32).toString('hex');
  const root = await realpath(options.staticDir);
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const fail = (status: number, message: string): void => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: message }));
    };
    try {
      if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) {
        fail(403, 'This board accepts same-origin loopback requests only.');
        return;
      }
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname === '/api') {
        if (request.method !== 'POST') { fail(405, 'Use POST for Beads requests.'); return; }
        const supplied = Buffer.from(request.headers.authorization ?? '');
        const expected = Buffer.from(`Bearer ${token}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { fail(401, 'Open the board using its authenticated launch link.'); return; }
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) { fail(415, 'Expected application/json.'); return; }
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > REQUEST_BODY_LIMIT) { fail(413, 'Request exceeds the 40 MiB JSON body limit.'); return; }
          chunks.push(Buffer.from(chunk));
        }
        let rpc: RpcRequest;
        try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcRequest; }
        catch { fail(400, 'Invalid JSON request.'); return; }
        const result = await handleRequest(rpc, options.projects);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result));
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { fail(405, 'Method not allowed.'); return; }
      const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const candidate = resolve(root, `.${name}`);
      if (!candidate.startsWith(`${root}${sep}`)) { fail(404, 'Not found.'); return; }
      let file: string;
      try { file = await realpath(candidate); }
      catch { fail(404, 'Not found.'); return; }
      if (!file.startsWith(`${root}${sep}`)) { fail(404, 'Not found.'); return; }
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!response.headersSent) fail(400, error instanceof Error ? error.message : 'Beads request failed.');
      else response.end();
    }
  });
  const listening = once(server, 'listening');
  server.listen(options.port ?? 0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local board did not bind a TCP port.');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: origin, token };
}
