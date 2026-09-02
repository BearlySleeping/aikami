// apps/backend/cloudflare/src/lib/db/index.ts
//
// C-455: D1 database subcommand router.

const dbSubcommand = Bun.argv[3];

switch (dbSubcommand) {
	case 'migrate':
		await import('./migrate.ts');
		break;
	case 'status':
		await import('./status.ts');
		break;
	case 'exec':
		await import('./exec.ts');
		break;
	case 'seed':
		await import('./seed.ts');
		break;
	case 'reset':
		await import('./reset.ts');
		break;
	case 'studio':
		await import('./studio.ts');
		break;
	default:
		console.error('Usage: bun run src/cli.ts db <subcommand>');
		console.error('  Subcommands: migrate, status, exec, seed, reset, studio');
		process.exit(1);
}

export {};
