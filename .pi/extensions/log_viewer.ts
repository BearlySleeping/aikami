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
      'View logs for any Aikami service — Cloud Run, Firebase Functions, or client (a static ' +
      'app with no server of its own; its browser logs are forwarded through hub and filtered ' +
      `automatically). Apps: ${KNOWN_APPS.join(', ')}.`,
    promptSnippet:
      'Use service_logs to view logs for any Aikami app. Supports --since, --severity, ' +
      '--message, --filter (raw Cloud Logging expression), and --tail for live streaming.',
    promptGuidelines: [
      "Use service_logs when user says 'hub crashed in staging' → app=hub, mode=staging.",
      "Use service_logs when user says 'check function logs for pollGmail' → app=firebase, only=pollGmail — firebase REQUIRES only, else it interleaves every function in the region.",
      "Use service_logs when user says 'tail the logs' → tail=true.",
      "Use service_logs when user says 'get logs from client where X' → app=client, message=X (or filter for a raw Cloud Logging filter expression).",
      "client has no server of its own — its browser logs land in hub's Cloud Run stream, filtered to just client automatically. No extra params needed for that.",
      'site/docs/client-tauri have no server-side logs at all (static hosting / desktop release) — service_logs will say so rather than returning anything.',
    ],
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
      const args = ['bun', 'run', 'scripts', '--', 'logs', params.app];
      if (params.mode) {
        args.push('--mode', params.mode);
      }
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

      const result = await pi.exec('env', args, {
        signal,
        timeout: params.tail ? DefaultTimeout : 60_000,
      });
      const raw = result.stdout || result.stderr || '';
      return {
        content: [{ type: 'text', text: smartTruncate(raw, 100) }],
        details: { code: result.code, app: params.app, tail: params.tail ?? false },
      };
    },
  });
}
