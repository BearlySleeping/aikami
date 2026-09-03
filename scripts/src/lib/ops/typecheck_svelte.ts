// scripts/src/lib/ops/typecheck_svelte.ts
//
// Wraps `svelte-check` for the client/hub `typecheck` task. svelte-check's
// default (human) reporter is fine standalone, but inside `moon ci` its
// output gets buried at the very end of a multi-thousand-line vite build
// log with no per-line marker on the PR itself.
//
// `--output machine-verbose` gives one JSON diagnostic per line (confirmed
// by reading svelte-check's MachineFriendlyWriter —
// node_modules/svelte-check/dist/src/index.js): `{ type, filename, start:
// {line, character}, end, message, code, codeDescription, source }`, 0-
// indexed. This script re-renders that as the same clean `file:line:col —
// message` shape the other guard scripts print, and calls annotate() per
// error so CI gets inline GitHub annotations — while local runs (no
// GITHUB_ACTIONS) look identical to today, just reformatted.
//
// Usage (from an app dir, e.g. apps/frontend/client):
//   bun ../../../scripts/src/lib/ops/typecheck_svelte.ts --tsconfig ./tsconfig.json
//
// Passes through any extra args to svelte-check unchanged. Exits with
// svelte-check's own exit code.

import { resolve } from 'node:path';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

const relPath = (absPath: string): string => {
  const rel = absPath.startsWith(ROOT) ? absPath.slice(ROOT.length + 1) : absPath;
  return rel.split('\\').join('/');
};

type Diagnostic = {
  type: 'ERROR' | 'WARNING';
  filename: string;
  start: { line: number; character: number };
  message: string;
  code?: string | number;
};

const parseLine = (raw: string): Diagnostic | null => {
  // Lines look like `<timestamp> {"type":"ERROR",...}` or
  // `<timestamp> START "..."` / `<timestamp> COMPLETED ...` — only the JSON
  // diagnostic lines matter here.
  const spaceIndex = raw.indexOf(' ');
  if (spaceIndex === -1) {
    return null;
  }
  const payload = raw.slice(spaceIndex + 1).trim();
  if (!payload.startsWith('{')) {
    return null;
  }
  try {
    return JSON.parse(payload) as Diagnostic;
  } catch {
    return null;
  }
};

const args = Bun.argv.slice(2);
const proc = Bun.spawn(['bunx', 'svelte-check', ...args, '--output', 'machine-verbose'], {
  cwd: process.cwd(),
  stdout: 'pipe',
  stderr: 'inherit',
});

const output = await new Response(proc.stdout).text();
const exitCode = await proc.exited;

let errorCount = 0;
let warningCount = 0;

for (const rawLine of output.split('\n')) {
  const diagnostic = parseLine(rawLine);
  if (!diagnostic) {
    continue;
  }
  const file = relPath(diagnostic.filename);
  const line = diagnostic.start.line + 1;
  const col = diagnostic.start.character + 1;
  const codeSuffix = diagnostic.code !== undefined ? ` [${diagnostic.code}]` : '';
  if (diagnostic.type === 'ERROR') {
    errorCount++;
    console.error(`❌ ${file}:${line}:${col} — ${diagnostic.message}${codeSuffix}`);
    annotate({ file, line, col, message: diagnostic.message, title: 'svelte-check' });
  } else {
    warningCount++;
    console.warn(`⚠️ ${file}:${line}:${col} — ${diagnostic.message}${codeSuffix}`);
  }
}

if (errorCount > 0 || warningCount > 0) {
  console.log(`\n${errorCount} error(s), ${warningCount} warning(s)`);
} else if (exitCode === 0) {
  console.log('✅ svelte-check passed — 0 errors, 0 warnings');
}

process.exit(exitCode);
