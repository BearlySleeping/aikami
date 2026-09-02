#!/usr/bin/env bun
// apps/backend/cloudflare/src/cli.ts
//
// C-455: Single entry point for all Cloudflare operations.
//
// Subcommands:
//   db        — D1 database operations (migrate, status, exec, seed, reset, studio)
//   storage   — R2 bucket operations (ls, get, put, rm, stat, sync, lifecycle, ensure)
//   dns       — DNS record operations (reconcile)
//   worker    — Cloudflare Worker deployment
//
// Usage:
//   bun run apps/backend/cloudflare/src/cli.ts db migrate --mode staging
//   bun run apps/backend/cloudflare/src/cli.ts db status --local
//   bun run apps/backend/cloudflare/src/cli.ts storage ls --mode staging
//   bun run apps/backend/cloudflare/src/cli.ts worker deploy --mode production

const cliSubcommand = Bun.argv[2];

switch (cliSubcommand) {
  case 'db':
    await import('./lib/db/index.ts');
    break;
  case 'storage':
    await import('./lib/storage/index.ts');
    break;
  case 'dns':
    await import('./lib/dns/index.ts');
    break;
  case 'worker':
    await import('./lib/worker/index.ts');
    break;
  default:
    process.exit(1);
}

export {};
