// apps/backend/cloudflare/src/lib/db/index.ts
//
// C-455: D1 database subcommand router.
//
// 🔴 Each case below MUST call the imported module's exported `main`
// explicitly. `migrate.ts`/`status.ts`/`exec.ts`/`seed.ts`/`reset.ts`/
// `studio.ts` gate their logic behind `if (import.meta.path === Bun.main)`
// so they can also run standalone (`bun run .../migrate.ts --local`) — but
// that guard is never true when this router dynamically imports them, since
// `Bun.main` stays this process's actual entry (`cli.ts`). A bare
// `await import(...)` with no call silently imports the module and runs
// nothing; every db subcommand was a no-op through the CLI until this was
// fixed. `generate_schemas.ts` is the one exception — it runs its `main()`
// unconditionally at module top-level, so importing it is enough.

const dbSubcommand = Bun.argv[3];

switch (dbSubcommand) {
  case 'migrate':
    await (await import('./migrate.ts')).main();
    break;
  case 'status':
    await (await import('./status.ts')).main();
    break;
  case 'exec':
    await (await import('./exec.ts')).main();
    break;
  case 'seed':
    await (await import('./seed.ts')).main();
    break;
  case 'reset':
    await (await import('./reset.ts')).main();
    break;
  case 'studio':
    (await import('./studio.ts')).main();
    break;
  case 'generate':
    await import('./generate_schemas.ts');
    break;
  default:
    process.exit(1);
}

export {};
