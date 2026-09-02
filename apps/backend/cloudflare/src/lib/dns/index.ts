// apps/backend/cloudflare/src/lib/dns/index.ts
//
// C-455: DNS record operations subcommand router.

const dnsSubcommand = Bun.argv[3];

switch (dnsSubcommand) {
  case 'reconcile':
    await import('./reconcile.ts');
    break;
  default:
    process.exit(1);
}

export {};
