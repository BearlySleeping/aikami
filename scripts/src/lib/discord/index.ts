#!/usr/bin/env bun
// scripts/src/lib/discord/index.ts
//
// CLI entry point for Aikami Discord server management. Manages channels,
// categories, and roles via structure.ts (declarative desired state) — see
// that file for the config, diff.ts for how comparisons work, and sync.ts
// for the safety rules around apply/prune.
//
// Auth setup: scripts/.env.example (DISCORD_BOT_TOKEN, DISCORD_GUILD_ID).
//
// Usage (via the "discord" short name registered in scripts/src/index.ts):
//   bun run scripts -- discord audit
//   bun run scripts -- discord audit --format=structure   (seed structure.ts)
//   bun run scripts -- discord audit --format=json
//   bun run scripts -- discord diff                        (plan only, no writes)
//   bun run scripts -- discord sync                        (same as diff — no writes)
//   bun run scripts -- discord sync --apply                 (create/update)
//   bun run scripts -- discord sync --apply --prune         (also delete)
//   bun run scripts -- discord commands:sync                (register /bug /feature /ask)
//
// Or via root package.json: bun run discord:audit / discord:diff / discord:sync

import { c, error, parseCliArgs } from '../cli_utils';
import { runAudit } from './audit';
import { syncDiscordCommands } from './commands';
import { runSync } from './sync';

const opts = parseCliArgs(Bun.argv.slice(2), {
  mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  format: { type: 'string' },
  apply: { type: 'boolean' },
  prune: { type: 'boolean' },
});

const subcommand = opts._[0];
const mode = opts.mode ?? 'production';

async function main(): Promise<void> {
  switch (subcommand) {
    case 'audit':
      await runAudit(mode, opts.format ?? 'table');
      return;
    case 'diff':
      await runSync(mode, { apply: false, prune: false });
      return;
    case 'sync':
      await runSync(mode, { apply: Boolean(opts.apply), prune: Boolean(opts.prune) });
      return;
    case 'commands:sync':
      await syncDiscordCommands(mode);
      return;
    default:
      error(`Unknown subcommand "${subcommand ?? ''}". Use: audit | diff | sync | commands:sync`);
      console.log(`${c.dim}See scripts/src/lib/discord/index.ts header for usage.${c.reset}`);
      process.exit(1);
  }
}

try {
  await main();
} catch (err) {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
