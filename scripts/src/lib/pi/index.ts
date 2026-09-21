#!/usr/bin/env bun
// scripts/src/lib/pi/index.ts
//
// The single Bun-side dispatcher behind the pi extension bridge
// (.pi/extensions/lib/bridge.ts).
//
// Invocation:
//   bun run scripts/src/lib/pi/index.ts <dotted.command>
// with a JSON request body on stdin:
//   { "command": "herdr.session.start", "cwd": "/optional", "payload": { ... } }
//
// Output (stdout, one line of pure JSON):
//   { "ok": true,  "data": <result> }
//   { "ok": false, "error": { "message": "...", "name": "...", "stack": "..." } }
//
// All incidental console output is redirected to stderr (silence_stdout.ts).

import './silence_stdout.ts';
import type { PiHandlers } from './types.ts';

const LOADERS: Record<string, () => Promise<{ handlers: PiHandlers }>> = {
  ai: () => import('./ai.ts'),
  contract: () => import('./contract.ts'),
  env: () => import('./env.ts'),
  git: () => import('./git.ts'),
  herdr: () => import('./herdr.ts'),
  worktree: () => import('./worktree.ts'),
};

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const readStdin = async (): Promise<string> => {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (!command) {
    write({ ok: false, error: { message: 'No bridge command provided (argv[2]).' } });
    return;
  }

  let payload: Record<string, unknown> = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      const request = JSON.parse(raw) as { payload?: unknown };
      if (
        request.payload &&
        typeof request.payload === 'object' &&
        !Array.isArray(request.payload)
      ) {
        payload = request.payload as Record<string, unknown>;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write({ ok: false, error: { message: `Invalid bridge request JSON: ${message}` } });
    return;
  }

  const domain = command.split('.')[0] ?? '';
  const loader = LOADERS[domain];
  if (!loader) {
    write({ ok: false, error: { message: `Unknown bridge command domain: ${domain}` } });
    return;
  }

  try {
    const { handlers } = await loader();
    const handler = handlers[command];
    if (!handler) {
      write({ ok: false, error: { message: `Unknown bridge command: ${command}` } });
      return;
    }
    const data = await handler(payload);
    write({ ok: true, data: data ?? null });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    write({ ok: false, error: { message: err.message, name: err.name, stack: err.stack } });
  }
};

await main();
