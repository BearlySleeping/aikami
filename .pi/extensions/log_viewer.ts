// .pi/extensions/log_viewer.ts
// Thin wrapper around `bun run scripts -- logs <app> [flags]`
// (scripts/src/lib/ops/logs.ts) — the single source of truth for querying
// Aikami service logs, driven by deployment_config.ts's APP_CONFIG.
//
// This file deliberately does NOT duplicate app→serviceType mappings —
// an earlier version hardcoded its own APP_CONFIG here and it drifted:
// `client` was Cloud Run until 2026-07-29, `hub` (the real Cloud Run SSR
// service) was added 2026-08-07, and this file's copy never caught up
// with either change, silently routing `app=client` at a script that
// never existed. All app resolution now lives in logs.ts; this extension
// only passes args through and surfaces that script's own errors.
//
// Direnv env vars (set by .envrc) — always available:
//   AIKAMI_MODE   — emulator | staging | production
//   AIKAMI_ROOT   — repo root

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { smartTruncate } from './lib/output_filter';
import { runCommand } from './lib/process_runner.ts';

// Local list for the tool's enum/help text only — NOT used for validation
// (logs.ts validates against the real APP_CONFIG and errors clearly on a
// bad app id). Kept as a plain array rather than imported, same rationale
// as gcloud_exec.ts's local MODE_PROJECT_MAP: .pi/extensions run outside
// the moon project graph. Source of truth: scripts/src/lib/deploy/
// deployment_config.ts's APP_CONFIG keys.
const KNOWN_APPS = [
  'client',
  'client-tauri',
  'site',
  'hub',
  'docs',
  'firebase',
  'image',
  'text',
  'voice',
];

export default function (pi: ExtensionAPI) {
  const DefaultTimeout = 180_000; // 3 min

  pi.registerTool({
    name: 'service_logs',
    label: 'Logs: View Service Logs',
    description:
      'View logs for any Aikami service — Cloud Run, Firebase Functions, Cloudflare Workers, or ' +
      'client (a static app with no server of its own; its browser logs are forwarded through hub ' +
      `and filtered automatically). Cloudflare Worker apps (client/site/docs/hub) are live-tail ` +
      `only — pass tail:true. Apps: ${KNOWN_APPS.join(', ')}.`,
    parameters: Type.Object({
      app: Type.String({
        description: `App to target: ${KNOWN_APPS.join(', ')}`,
      }),
      mode: Type.Optional(
        Type.String({
          description:
            'Deployment mode — logs are only available for staging/production, not emulator.',
          enum: ['staging', 'production'],
          default: 'staging',
        }),
      ),
      tail: Type.Optional(
        Type.Boolean({
          description: 'Stream logs live instead of a one-shot read.',
          default: false,
        }),
      ),
      since: Type.Optional(
        Type.String({ description: "Time window, e.g. '1h', '30m', '10m', '2d'." }),
      ),
      lines: Type.Optional(
        Type.Number({ description: 'Max entries for a one-shot read (default 50).' }),
      ),
      severity: Type.Optional(
        Type.String({ description: 'DEBUG|INFO|WARNING|ERROR|CRITICAL — filters severity>=this.' }),
      ),
      only: Type.Optional(
        Type.String({
          description: 'Function name — required to scope `firebase` to one function.',
        }),
      ),
      message: Type.Optional(
        Type.String({ description: 'Substring match against the log message.' }),
      ),
      filter: Type.Optional(
        Type.String({
          description: 'Raw Cloud Logging filter fragment, ANDed onto the base filter.',
        }),
      ),
      json: Type.Optional(
        Type.Boolean({
          description: 'Full structured JSON output instead of the compact default.',
          default: false,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // Default undefined mode to 'staging' — logs are only available for
      // staging/production, and the tool help declares staging as the default.
      // Always pass --mode explicitly so logs.ts never falls back to the
      // ambient AIKAMI_MODE (which may be 'emulator' in dev).
      const mode = params.mode ?? 'staging';
      const args = ['bun', 'run', 'scripts', '--', 'logs', params.app];
      args.push('--mode', mode);
      if (params.tail) {
        args.push('--tail');
      }
      if (params.since) {
        args.push('--since', params.since);
      }
      if (params.lines) {
        args.push('--lines', String(params.lines));
      }
      if (params.severity) {
        args.push('--severity', params.severity);
      }
      if (params.only) {
        args.push('--only', params.only);
      }
      if (params.message) {
        args.push('--message', params.message);
      }
      if (params.filter) {
        args.push('--filter', params.filter);
      }
      if (params.json) {
        args.push('--json');
      }

      const result = await runCommand('env', args, {
        signal,
        timeoutMs: params.tail ? DefaultTimeout : 60_000,
        // Run from the repo root (direnv's AIKAMI_ROOT) so `bun run scripts`
        // resolves the workspace regardless of pi's current cwd.
        cwd: process.env.AIKAMI_ROOT,
      });
      // Keep stderr diagnostics (gcloud writes progress/warnings there) and
      // surface non-zero exits explicitly instead of returning them as log
      // data.
      const streams = [result.stdout, result.stderr].filter(Boolean).join('\n');
      const raw = result.code === 0 ? streams : `Command failed (exit ${result.code}):\n${streams}`;
      return {
        content: [{ type: 'text', text: smartTruncate(raw, 100) }],
        details: { code: result.code, app: params.app, tail: params.tail ?? false },
      };
    },
  });
}
