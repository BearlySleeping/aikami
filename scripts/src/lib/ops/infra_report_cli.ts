#!/usr/bin/env bun
// scripts/src/lib/ops/infra_report_cli.ts
//
// CLI entry point for the infrastructure-issue log. Kept OUT of
// infra_report.ts (the library module) on purpose:
//
// 🔴 infra_report.ts is reachable from .pi/extensions/* via worktree.ts,
// session.ts, git_worktree.ts and orchestrator.ts, which pi loads under
// Node via jiti. A module that uses `import.meta` and is large gets loaded
// through a base64 `data:` URL, and bun rejects that with ENAMETOOLONG
// (NameTooLong). The `if (import.meta.main)` CLI block was exactly that
// trigger. Moving it here keeps the library module plain — no `import.meta`,
// no CLI — so the extension import graph stays loadable.
//
// Usage:
//   bun run infra:report              # ranked table, newest-fingerprint-first
//   bun run infra:report --json       # machine-readable
//   bun run infra:report --since 24h  # only entries from the last 24h

import { readInfraIssues, summarizeInfraIssues } from './infra_report.ts';

// Minimal inline ANSI codes (same rationale as infra_report.ts: this module
// must not pull in the shared Bun-using formatting helpers).
const ansi = {
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  reset: '\x1b[0m',
};

const parseSince = (raw: string | undefined): number | undefined => {
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/^(\d+)(h|d|m)$/);
  if (!match) {
    return undefined;
  }
  const n = Number(match[1]);
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd'];
  return n * unitMs;
};

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const sinceIndex = args.indexOf('--since');
const sinceMs = sinceIndex >= 0 ? parseSince(args[sinceIndex + 1]) : undefined;

const events = readInfraIssues(process.cwd());
const summary = summarizeInfraIssues(events, { sinceMs });

if (jsonMode) {
  console.log(JSON.stringify(summary, undefined, 2));
} else if (summary.length === 0) {
  console.log(`${ansi.green}✓${ansi.reset} No infrastructure issues recorded.`);
} else {
  console.log(
    `\n${ansi.bold}Infrastructure issues (${summary.length} distinct, ${events.length} total)${ansi.reset}`,
  );
  for (const s of summary) {
    console.log(
      `\n${ansi.bold}${ansi.yellow}×${s.count}${ansi.reset}  ${ansi.bold}[${s.component}]${ansi.reset} ${s.operation}`,
    );
    console.log(`     ${s.error}`);
    console.log(`     ${ansi.dim}first ${s.firstSeen} · last ${s.lastSeen}${ansi.reset}`);
  }
  console.log();
}
