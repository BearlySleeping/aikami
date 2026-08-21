// scripts/src/lib/deploy/firebase.ts
/**
 * Firebase deployments — Functions (firebase). Hosting moved to Cloudflare
 * Workers (see ./cloudflare.ts).
 */

import { c, log, ok } from '../cli_utils';
import type { AppConfig } from './deployment_config';
import { resolveProjectId, run } from './utils';

// ── Firebase Functions ───────────────────────────────────────────────────
//
// C-418 Feature D trimmed this stage: the `auth` and `poll_device_handoff`
// callables moved to the hub's Elysia API, and the logging-only auth/
// firestore triggers plus the no-op `daily` scheduler were deleted. The only
// remaining controller is `api/discord_interactions.ts` (Discord webhook —
// signature verification + Firestore-backed rate limiting + deferred
// interaction timing, kept on Functions per C-418 OQ-3 disposition).
// firestack auto-discovers controllers, so this stage now deploys exactly
// that one function.

export async function deployFirebaseFunctions(
  _config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  isForce = false,
): Promise<void> {
  const projectId = resolveProjectId(mode);

  log(`\n${c.bold}🚀 Deploying ${appName} to Firebase Functions${c.reset}`);
  log(`  Project: ${projectId}\n`);

  log('⚡ Deploying functions...');
  const forceFlag = isForce ? ' --force' : '';
  run(`bunx moon run ${appName}:deploy${forceFlag} -- --mode=${mode} --deploy-engine gcloud`, {
    cwd: rootDir,
  });
  ok(`${appName} deployed`);
}
