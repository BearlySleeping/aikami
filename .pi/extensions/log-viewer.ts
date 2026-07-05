// .pi/extensions/log-viewer.ts
// Unified log viewer across all Aikami services.
//
// Routes by action:
//   action=logs (default):
//     cloud-run (client)       → scripts/ops/logs.ts → gcloud logging
//     firebase-hosting       → scripts/ops/logs.ts → gcloud logging
//     firebase-functions     → bun moon run functions:logs → firestack → gcloud
//
// Also delegates Firestore data queries to firestore_query tool.
//
// Direnv env vars (set by .envrc) — always available:
//   AIKAMI_MODE          — emulator | staging | production
//   AIKAMI_PROJECT_ID    — GCP project id

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';

import { smartTruncate } from './lib/output-filter';

const APP_CONFIG: Record<string, { serviceType: string }> = {
  client: { serviceType: 'cloud-run' },
  functions: { serviceType: 'firebase-functions' },
  site: { serviceType: 'firebase-hosting' },
};

const APP_SERVICE_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(APP_CONFIG).map(([key, config]) => [key, config.serviceType]),
);

const VALID_APPS = Object.keys(APP_SERVICE_TYPES);

export default function (pi: ExtensionAPI) {
  const DefaultTimeout = 180_000; // 3 min

  pi.registerTool({
    name: 'service_logs',
    label: 'Logs: View Service Logs',
    description:
      'View logs for Aikami services. ' +
      'Apps: client, site, functions. ' +
      'Log actions: tail, line limits, time filters, function name filters. ' +
      'For emulator Firestore data inspection, use firestore_query.',
    promptSnippet:
      'Use service_logs to view Cloud Run / Firebase logs. All logs are streamed to Cloud Run stdout — not stored in Firestore.',
    promptGuidelines: [
      "Use service_logs when user says 'the client crashed in dev' → app=client, mode=staging.",
      "Use service_logs when user says 'check function logs for pollGmail' → app=functions, only=pollGmail.",
      "Use service_logs when user says 'tail the logs' → tail=true.",
      'For functions, route via firestack (handles --only, --type, --since, --tail, --mode natively).',
      'For Cloud Run (client) and Hosting (site), route via gcloud logging script.',
    ],
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({
          description: "Action: 'logs' (default) to view logs.",
          enum: ['logs'],
          default: 'logs',
        }),
      ),
      app: Type.Optional(
        Type.String({
          description: `App to target: ${VALID_APPS.join(', ')}`,
          enum: VALID_APPS,
          default: 'functions',
        }),
      ),
      mode: Type.Optional(
        Type.String({
          description: 'Deployment mode',
          enum: ['staging', 'production', 'emulator'],
          default: 'staging',
        }),
      ),
      lines: Type.Optional(
        Type.Number({ description: 'Number of log lines (default 50)', default: 50 }),
      ),
      tail: Type.Optional(Type.Boolean({ description: 'Tail logs in real-time', default: false })),
      since: Type.Optional(
        Type.String({
          description:
            "Only show logs after this time, e.g. '1h', '30m', '10m'. Works for all apps.",
        }),
      ),
      only: Type.Optional(
        Type.String({
          description:
            'Filter: function name for Firebase Functions, or service name for Cloud Run.',
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const app = params.app ?? 'functions';
      // Resolve mode: explicit param > direnv env > "staging" default
      const mode = params.mode ?? (process.env.AIKAMI_MODE as string | undefined) ?? 'staging';
      const lines = params.lines ?? 50;
      const serviceType = APP_SERVICE_TYPES[app];

      // ── Logs action ──────────────────────────────────────────────────
      if (!serviceType) {
        return {
          content: [{ type: 'text', text: `Unknown app: ${app}. Valid: ${VALID_APPS.join(', ')}` }],
          details: { code: 1, source: 'unknown_app' },
        };
      }

      if (serviceType === 'browser-extension') {
        return {
          content: [
            {
              type: 'text',
              text: 'Browser extension logs are not available server-side. Check Chrome DevTools → Console.',
            },
          ],
          details: { code: 0, source: 'browser-extension' },
        };
      }

      if (!process.env.AIKAMI_PROJECT_ID && mode !== 'emulator') {
        return {
          content: [
            { type: 'text', text: `Unknown mode: ${mode} (AIKAMI_PROJECT_ID not set by direnv)` },
          ],
          details: { code: 1, source: 'unknown_mode' },
        };
      }

      // ── Route by service type ──────────────────────────────────────────
      const tail = params.tail ?? false;

      if (serviceType === 'firebase-functions') {
        // Route through firestack (moon run functions:logs → firestack logs).
        // firestack handles gen2 Cloud Run service name mapping, --since, --tail, --only natively.
        const args = [
          'bun',
          'moon',
          'run',
          'functions:logs',
          '--',
          '--mode',
          mode,
          '--lines',
          String(lines),
        ];
        if (tail) {
          args.push('--tail');
        }
        if (params.only) {
          args.push('--only', params.only);
        }
        if (params.since) {
          args.push('--since', params.since);
        }

        const result = await pi.exec('env', args, { signal, timeout: DefaultTimeout });
        const raw = result.stdout || result.stderr || '';
        return {
          content: [{ type: 'text', text: smartTruncate(raw, 100) }],
          details: { code: result.code, source: 'firebase-functions', tail },
        };
      }

      // cloud-run + firebase-hosting → scripts:run (gcloud logging read/tail)
      if (serviceType === 'cloud-run' || serviceType === 'firebase-hosting') {
        const args = [
          'bun',
          'moon',
          'run',
          'scripts:run',
          '--',
          'logs',
          app,
          '--mode',
          mode,
          '--lines',
          String(lines),
        ];
        if (tail) {
          args.push('--tail');
        }
        if (params.only) {
          args.push('--only', params.only);
        }
        if (params.since) {
          args.push('--since', params.since);
        }

        const result = await pi.exec('env', args, { signal, timeout: DefaultTimeout });
        const raw = result.stdout || result.stderr || '';
        return {
          content: [{ type: 'text', text: smartTruncate(raw, 100) }],
          details: { code: result.code, source: serviceType, tail },
        };
      }

      // Unreachable — all service types handled above
      return {
        content: [{ type: 'text', text: `Log viewing not supported for: ${serviceType}` }],
        details: { code: 1, source: 'unsupported' },
      };
    },
  });
}
