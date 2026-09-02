// apps/backend/cloudflare/src/lib/worker/index.ts
//
// C-455: Cloudflare Worker deployment. Moved from scripts/src/lib/deploy/cloudflare.ts.
// Resolves the name collision between scripts/src/lib/deploy/cloudflare.ts and
// the moon project named "cloudflare" — now lives in apps/backend/cloudflare/src/lib/worker/.

import { deployWorker } from './deploy.ts';

const workerSubcommand = Bun.argv[3];

switch (workerSubcommand) {
  case 'deploy':
    await deployWorker();
    break;
  default:
    process.exit(1);
}
