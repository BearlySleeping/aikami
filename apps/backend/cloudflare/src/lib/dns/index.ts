// apps/backend/cloudflare/src/lib/dns/index.ts
//
// C-455: DNS record operations subcommand router.

import { reconcileDns } from './reconcile.ts';

const dnsSubcommand = Bun.argv[3];

switch (dnsSubcommand) {
  case 'reconcile':
    reconcileDns();
    break;
  default:
    process.exit(1);
}
