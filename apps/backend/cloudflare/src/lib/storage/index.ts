// apps/backend/cloudflare/src/lib/storage/index.ts
//
// C-455: R2 bucket operations subcommand router.

const storageSubcommand = Bun.argv[3];

switch (storageSubcommand) {
	case 'ls':
		await import('./ls.ts');
		break;
	case 'get':
		await import('./get.ts');
		break;
	case 'put':
		await import('./put.ts');
		break;
	case 'rm':
		await import('./rm.ts');
		break;
	case 'stat':
		await import('./stat.ts');
		break;
	case 'sync':
		await import('./sync.ts');
		break;
	case 'lifecycle':
		await import('./lifecycle.ts');
		break;
	case 'ensure':
		await import('./ensure.ts');
		break;
	default:
		console.error('Usage: bun run src/cli.ts storage <subcommand>');
		console.error('  Subcommands: ls, get, put, rm, stat, sync, lifecycle, ensure');
		process.exit(1);
}

export {};
