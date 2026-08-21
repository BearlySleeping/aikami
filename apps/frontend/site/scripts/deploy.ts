/** biome-ignore-all lint/suspicious/noConsole: Deploy scripts run standalone; console.error is intentional. */
// apps/frontend/site/scripts/deploy.ts
/**
 * Cloudflare Worker deploy script for the site app.
 *
 * Delegates to the shared Cloudflare deploy CLI helper (single source of
 * truth in scripts/src/lib/deploy/cloudflare.ts), which owns argument
 * parsing, the APP_CONFIG guard, deployment invocation, and error handling.
 * Per-app config (worker name, route, build output dir, headers) lives in
 * deployment_config.ts.
 */

import { deployCloudflareApp } from '../../../../scripts/src/lib/deploy/cloudflare';

await deployCloudflareApp('site');
