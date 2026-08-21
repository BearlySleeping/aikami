// scripts/src/lib/ops/logs.ts
/**
 * Unified log viewer — single source of truth for fetching logs across
 * every Aikami service, driven entirely by deployment_config.ts's
 * APP_CONFIG. Add a new Cloud Run service there (e.g. migrate image/text/
 * voice off self-hosted GPU boxes) and it works here with zero changes.
 *
 * Used by:
 *   - `bun run scripts -- logs <app> [flags]`   (manual CLI)
 *   - .pi/extensions/log_viewer.ts              (pi/LLM tool call)
 *
 * Cloudflare Workers (serviceType `cloudflare-worker`) and `firebase-functions`
 * — functions are queried via `gcloud logging read`/`tail` against
 * `resource.type="cloud_run_revision"`; Workers logs live in Cloudflare
 * Workers Observability and are not reachable via gcloud.
 *
 * `client` (static Worker, no server of its own) has no logs of its
 * own — its browser logger forwards cross-origin into hub's
 * /api/internal_logging (see packages/shared/logger/src/lib/
 * logger_browser.ts and hub's hooks.server.ts), tagged
 * `jsonPayload.app="client"`.
 */

import { resolve } from 'node:path';
import { c, error, log, parseCliArgs } from '../cli_utils';
import { APP_CONFIG, CLOUD_FUNCTIONS_REGION } from '../deploy/deployment_config';
import { ensureGcloudAuth, resolveProjectId, runArgs } from '../deploy/utils';

const ROOT_DIR = resolve(import.meta.dir, '../../../..');

type AppId = keyof typeof APP_CONFIG;
const VALID_APPS = Object.keys(APP_CONFIG) as AppId[];

// ── Resolve target ───────────────────────────────────────────────────────

export type LogTarget = {
  projectId: string;
  region: string;
  /** Empty string = no service_name filter (all services in the region). */
  serviceName: string;
  extraFilter?: string;
  note?: string;
};

/**
 * Resolve which Cloud Logging target an app maps to: Cloud Run services
 * and Firebase Functions (gen2) both live under cloud_run_revision
 * resources; `client` redirects to hub's stream with an app filter;
 * static/desktop/docker-release apps return an unsupported message.
 */
export function resolveLogTarget(
  appId: AppId,
  mode: string,
  only: string | undefined,
): LogTarget | { unsupported: string } {
  const config = APP_CONFIG[appId];
  const projectId = resolveProjectId(mode);

  switch (config.serviceType) {
    case 'cloudflare-worker': {
      // client, site, docs, hub are all Cloudflare Workers now — their logs
      // live in Cloudflare Workers Observability, not GCP Cloud Logging.
      return {
        unsupported:
          `${appId} is a Cloudflare Worker — server logs are in Cloudflare Workers ` +
          `Observability (dashboard or \`wrangler tail\`), not GCP Cloud Logging. ` +
          `'client' browser logs are forwarded to the hub Worker's /api/internal_logging.`,
      };
    }

    case 'firebase-functions': {
      if (!only) {
        return {
          projectId,
          region: CLOUD_FUNCTIONS_REGION,
          serviceName: '',
          note: 'No --only <functionName> given — showing ALL functions in this region interleaved.',
        };
      }
      return { projectId, region: CLOUD_FUNCTIONS_REGION, serviceName: only };
    }

    case 'tauri-release':
      return { unsupported: `${appId} is a desktop release artifact — no server logs.` };

    case 'database-migration':
      return {
        unsupported:
          `${appId} is a one-shot migration job (C-394 AC-5) with no runtime — ` +
          'there are no server logs to stream. Run it via `bun run deploy database --mode=production`.',
      };

    case 'docker-release':
      return {
        unsupported:
          `${appId} runs on self-hosted GPU infrastructure (not Cloud Run) and isn't wired to ` +
          'Cloud Logging yet. Once its serviceType in deployment_config.ts moves to a Cloud Run ' +
          'type, this command picks it up automatically — no changes needed here.',
      };

    default:
      return { unsupported: `Unknown service type for ${appId}: ${config.serviceType}` };
  }
}

// ── Filter builder ───────────────────────────────────────────────────────

/** Valid Cloud Logging severity levels for the severity>= filter. */
const SEVERITY_LEVELS = [
  'DEBUG',
  'INFO',
  'NOTICE',
  'WARNING',
  'ERROR',
  'CRITICAL',
  'ALERT',
  'EMERGENCY',
] as const;

/**
 * Build the Cloud Logging filter expression for a target and option set:
 * base resource/location/service clauses, optional app extraFilter,
 * validated severity>=, quoted jsonPayload.message substring (with quote
 * escaping) and a raw filter fragment ANDed on.
 */
export function buildFilter(
  target: LogTarget,
  opts: { severity?: string; message?: string; filter?: string },
): string {
  const parts = [
    'resource.type="cloud_run_revision"',
    `resource.labels.location="${target.region}"`,
  ];
  if (target.serviceName) {
    // Escape quotes like the message clause below — service ids come from
    // APP_CONFIG but defensive escaping keeps the filter expression valid.
    parts.push(`resource.labels.service_name="${target.serviceName.replace(/"/g, '\\"')}"`);
  }
  if (target.extraFilter) {
    parts.push(target.extraFilter);
  }
  if (opts.severity) {
    const severity = opts.severity.toUpperCase();
    if (!SEVERITY_LEVELS.includes(severity as (typeof SEVERITY_LEVELS)[number])) {
      throw new Error(
        `Invalid --severity "${opts.severity}". Valid values: ${SEVERITY_LEVELS.join(', ')}`,
      );
    }
    parts.push(`severity>=${severity}`);
  }
  if (opts.message) {
    parts.push(`jsonPayload.message:"${opts.message.replace(/"/g, '\\"')}"`);
  }
  if (opts.filter) {
    parts.push(opts.filter);
  }
  return parts.join(' AND ');
}

// ── Main ──────────────────────────────────────────────────────────────────

/** Print the `logs <app>` CLI usage to stderr. */
function printUsage(): void {
  error('Usage: logs <app> [flags]');
  error(`  app                Apps: ${VALID_APPS.join(', ')}`);
  error('  --mode             staging | production (default: $AIKAMI_MODE or staging)');
  error('  --tail             Stream logs live instead of a one-shot read');
  error('  --since <dur>      e.g. 1h, 30m, 2d (maps to gcloud --freshness)');
  error('  --lines <n>        Max entries for a one-shot read (default 50)');
  error('  --severity <lvl>   DEBUG|INFO|WARNING|ERROR|CRITICAL — filters severity>=lvl');
  error('  --only <name>      Required to scope `firebase` to one function');
  error('  --message <text>   Substring match against jsonPayload.message');
  error('  --filter <raw>     Raw Cloud Logging filter fragment, ANDed onto the base filter');
  error('  --json             Full structured JSON output instead of the compact default');
}

/**
 * CLI entry: parse args, resolve the target for the requested app, ensure
 * gcloud auth, then run a one-shot `gcloud logging read` or a live
 * `gcloud logging tail`.
 */
async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    tail: { type: 'boolean', aliases: ['t'] },
    since: { type: 'string' },
    lines: { type: 'string', aliases: ['n'] },
    severity: { type: 'string', aliases: ['s'] },
    only: { type: 'string' },
    filter: { type: 'string', aliases: ['f'] },
    message: { type: 'string' },
    json: { type: 'boolean' },
  });

  const appId = opts._[0] as AppId | undefined;
  if (!appId || !VALID_APPS.includes(appId)) {
    printUsage();
    process.exit(1);
  }

  const mode = opts.mode ?? process.env.AIKAMI_MODE ?? 'staging';
  if (mode !== 'staging' && mode !== 'production') {
    error(
      `Unsupported mode "${mode}" — logs are only available for staging/production (not emulator).`,
    );
    process.exit(1);
  }

  const target = resolveLogTarget(appId, mode, opts.only);
  if ('unsupported' in target) {
    error(target.unsupported);
    process.exit(1);
  }
  if (target.note) {
    log(`${c.dim}${target.note}${c.reset}`);
  }

  ensureGcloudAuth(mode, target.projectId, ROOT_DIR);

  const filter = buildFilter(target, {
    severity: opts.severity,
    message: opts.message,
    filter: opts.filter,
  });

  log(
    `${c.dim}project: ${target.projectId} · region: ${target.region}` +
      `${target.serviceName ? ` · service: ${target.serviceName}` : ' · service: (all)'}${c.reset}`,
  );

  if (opts.tail) {
    try {
      runArgs(['gcloud', 'logging', 'tail', filter, '--project', target.projectId], {
        live: true,
      });
    } catch (err) {
      // `gcloud logging tail` needs the grpcio Python module; on machines
      // without it the command fails immediately at startup. Give the user
      // the fix instead of a bare "Command failed".
      error('gcloud logging tail failed to start. It requires the grpcio Python module:');
      error('  pip3 install grpcio');
      error('  export CLOUDSDK_PYTHON_SITEPACKAGES=1');
      error('(see https://cloud.google.com/sdk/docs/troubleshooting#grpcio)');
      throw err;
    }
    return;
  }

  const format = opts.json
    ? 'json'
    : 'value(timestamp, severity, jsonPayload.message, textPayload)';
  const args = [
    'gcloud',
    'logging',
    'read',
    filter,
    '--project',
    target.projectId,
    '--limit',
    opts.lines ?? '50',
    '--order',
    'desc',
    '--format',
    format,
  ];
  if (opts.since) {
    args.push('--freshness', opts.since);
  }
  runArgs(args, { live: true });
}

// ── Entry ────────────────────────────────────────────────────────────────

// Guarded so tests can import the pure functions (buildFilter,
// resolveLogTarget) without triggering the CLI. When run via
// `bun run scripts -- logs ...` (or directly with `bun run logs.ts`), this
// file IS the entry point and import.meta.main is true.
if (import.meta.main) {
  main().catch((err) => {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
