// apps/backend/cloudflare/src/lib/storage/index.ts
//
// C-455: R2 bucket operations subcommand router.

import { runEnsureCommand } from './ensure.ts';
import { runGetCommand } from './get.ts';
import { runLifecycleCommand } from './lifecycle.ts';
import { runListCommand } from './ls.ts';
import { runPutCommand } from './put.ts';
import { runRemoveCommand } from './rm.ts';
import { runStatCommand } from './stat.ts';
import { runSyncCommand } from './sync.ts';

const storageSubcommand = Bun.argv[3];

switch (storageSubcommand) {
  case 'ls':
    runListCommand();
    break;
  case 'get':
    runGetCommand();
    break;
  case 'put':
    runPutCommand();
    break;
  case 'rm':
    await runRemoveCommand();
    break;
  case 'stat':
    runStatCommand();
    break;
  case 'sync':
    await runSyncCommand();
    break;
  case 'lifecycle':
    await runLifecycleCommand();
    break;
  case 'ensure':
    await runEnsureCommand();
    break;
  default:
    process.exit(1);
}
