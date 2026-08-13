/**
 * apps/backend/local-stack/docker/client-server/client_server.ts
 *
 * Minimal Bun static file server for the Ultimate container's client SPA.
 * Serves /app/build with SPA fallback (unknown routes -> index.html).
 * Started via `bun run start` by docker/scripts/entrypoint-ultimate.sh.
 */

import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { serve } from 'bun';

const ROOT = process.env.CLIENT_ROOT ?? '/app/build';
const PORT = Number(process.env.CLIENT_PORT ?? 3000);
const HOST = process.env.CLIENT_HOST ?? '0.0.0.0';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

serve({
  port: PORT,
  hostname: HOST,
  fetch(req) {
    const url = new URL(req.url);

    // Resolve the requested path inside ROOT, rejecting traversal.
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const headers: Record<string, string> = {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
      };
      // Hashed assets can be cached aggressively.
      if (pathname.startsWith('/_app/')) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      }
      // The runtime engine config must never be cached — a topology change
      // must take effect without a hard reload (C-389).
      if (pathname === '/config.json') {
        headers['Cache-Control'] = 'no-store';
      }
      return new Response(Bun.file(filePath), { headers });
    }

    // SPA fallback
    const index = join(ROOT, 'index.html');
    if (existsSync(index)) {
      return new Response(Bun.file(index), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
});

// biome-ignore lint/suspicious/noConsole: container startup log (standalone Bun script, no logger dependency)
console.log(`[client] Aikami client serving ${ROOT} on http://${HOST}:${PORT}`);
