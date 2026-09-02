// apps/backend/cloudflare/src/lib/worker/index.ts
//
// C-455: Cloudflare Worker deployment. Moved from scripts/src/lib/deploy/cloudflare.ts.
// Resolves the name collision between scripts/src/lib/deploy/cloudflare.ts and
// the moon project named "cloudflare" — now lives in apps/backend/cloudflare/src/lib/worker/.

const workerSubcommand = Bun.argv[3];

switch (workerSubcommand) {
	case 'deploy':
		await import('./deploy.ts');
		break;
	default:
		console.error('Usage: bun run src/cli.ts worker <subcommand>');
		console.error('  Subcommands: deploy');
		process.exit(1);
}

export {};
