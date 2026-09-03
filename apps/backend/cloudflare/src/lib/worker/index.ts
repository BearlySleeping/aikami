// apps/backend/cloudflare/src/lib/worker/index.ts
//
// 🔴 NOT YET LIVE. `./deploy.ts`'s `deployWorker()` is a partial sketch —
// it has no checksum-cache check, no moon build step, no _headers
// injection, and it expects a pre-existing wrangler.jsonc on disk instead
// of generating one. scripts/src/lib/deploy/cloudflare.ts (498 lines) is
// still the ONLY implementation any real deploy path calls: all four of
// apps/frontend/{client,hub,site,docs}/scripts/deploy.ts, plus
// scripts/src/index.ts's re-export, import `deployCloudflareApp` /
// `deployCloudflareWorker` from there, not from here. Do not repoint them
// at this module until `deployWorker()` actually matches that behavior —
// see the file's own header for the gap list. Finishing the move is real
// work against a production deploy path; treat it as its own contract.

import { deployWorker } from './deploy.ts';

const workerSubcommand = Bun.argv[3];

switch (workerSubcommand) {
  case 'deploy':
    await deployWorker();
    break;
  default:
    process.exit(1);
}
