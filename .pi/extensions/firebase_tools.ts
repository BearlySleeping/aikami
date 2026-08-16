// .pi/extensions/firebase_tools.ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
// Direnv env vars (set by .envrc / scripts/direnv/) — always available:
//   AIKAMI_MODE          — emulator | staging | production
//   AIKAMI_PROJECT_ID    — GCP project id (demo-aikami-emulator | aikami-dev | aikami-prod)
import { isAikamiMode, resolveAikamiMode } from '../../scripts/src/lib/env/mode';
import {
  type AikamiMode,
  isPortReady,
  listServices,
  startServices,
  stopServices,
} from '../../scripts/src/lib/herdr/session';
import { smartTruncate } from './lib/output_filter';
import { runCommand } from './lib/process_runner.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

const MODES = ['staging', 'production'] as const;
type Mode = (typeof MODES)[number];

/** Resolve GCP project id from direnv env; fall back to known defaults */
function getProjectId(mode: Mode): string {
  return process.env.AIKAMI_PROJECT_ID ?? (mode === 'staging' ? 'aikami-dev' : 'aikami-prod');
}

export default function (pi: ExtensionAPI) {
  const DefaultTimeout = 180_000; // 3 min
  const HeavyTimeout = 300_000; // 5 min (deploys, emulator starts)

  // Query Firestore directly from pi
  registerNamespace(pi, {
    name: 'firebase',
    label: 'Firebase',
    description: 'Query Firestore, deploy Cloud Functions, and control the local emulator suite.',
    actions: [
      defineAction({
        action: 'query',
        summary: 'Query a Firestore collection via the admin SDK',

        parameters: Type.Object({
          collection: Type.String({
            description: "Firestore collection path, e.g. 'users' or 'configs/site'",
          }),
          limit: Type.Optional(
            Type.Number({ description: 'Max documents to return', default: 10 }),
          ),
          env: Type.Optional(
            Type.String({
              description: 'Target environment',
              enum: MODES as unknown as string[],
              default: 'emulator',
            }),
          ),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
          // Resolve mode: explicit param > direnv env > "emulator" default
          const mode: AikamiMode = isAikamiMode(params.env) ? params.env : resolveAikamiMode();
          if (mode === 'emulator') {
            const result = await runCommand(
              'bun',
              [
                'run',
                'scripts/temp/firestore_query.ts',
                '--collection',
                params.collection,
                '--limit',
                String(params.limit ?? 10),
                '--emulator',
              ],
              { signal, timeoutMs: DefaultTimeout },
            );
            return {
              content: [{ type: 'text', text: result.stdout || result.stderr }],
              details: { code: result.code },
            };
          }
          const projectId = getProjectId(mode as Mode);
          const result = await runCommand(
            'bun',
            [
              'run',
              'scripts/temp/firestore_query.ts',
              '--collection',
              params.collection,
              '--limit',
              String(params.limit ?? 10),
              '--project',
              projectId,
            ],
            { signal, timeoutMs: DefaultTimeout },
          );
          return {
            content: [{ type: 'text', text: result.stdout || result.stderr }],
            details: { code: result.code, projectId, mode },
          };
        },
      }),
      defineAction({
        action: 'deploy_functions',
        summary: 'Build and deploy Cloud Functions via firestack',

        parameters: Type.Object({
          mode: Type.Optional(
            Type.String({
              description: 'Deployment mode',
              enum: ['staging', 'production'],
              default: 'staging',
            }),
          ),
          only: Type.Optional(
            Type.String({
              description:
                'Deploy specific functions only (comma-separated names). Passes --only to firestack. Skips rules automatically.',
            }),
          ),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
          // Resolve mode: explicit param > direnv env > "staging" default
          const mode = params.mode ?? (process.env.AIKAMI_MODE as string | undefined) ?? 'staging';
          const args = ['bun', 'moon', 'run', 'functions:deploy', '--', mode];
          if (params.only) {
            args.push('--only', params.only);
          }
          const result = await runCommand('env', args, { signal, timeoutMs: HeavyTimeout });
          const raw = result.stdout || result.stderr || '';
          const filtered = raw.length > 8000 ? smartTruncate(raw, 80) : raw;
          return {
            content: [{ type: 'text', text: filtered }],
            details: { code: result.code, mode, only: params.only },
          };
        },
      }),
      defineAction({
        action: 'emulator',
        summary: 'Start, stop or check the emulator suite',

        parameters: Type.Object({
          action: Type.String({
            description: 'Action to perform',
            enum: ['start', 'stop', 'status'],
          }),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
          if (params.action === 'start') {
            // Check if emulator is already running (port 4400 = emulator UI)
            if (await isPortReady(4400)) {
              return {
                content: [
                  { type: 'text', text: '✅ Emulator already running (port 4400 responding).' },
                ],
                details: { code: 0, alreadyRunning: true },
              };
            }

            // Start via herdr session API — creates/herdr workspace aikami-emulator
            // with a firebase tab running `bun run emulate`.
            _onUpdate?.({
              content: [{ type: 'text', text: 'Starting emulator via herdr (aikami-emulator)...' }],
              details: {},
            });

            const mode: AikamiMode = 'emulator';
            await startServices({ mode, services: ['firebase'] });

            // Poll for readiness (up to 60s)
            let ready = false;
            for (let i = 0; i < 30 && !ready; i++) {
              if (signal?.aborted) {
                break;
              }
              await new Promise((r) => setTimeout(r, 2000));
              ready = await isPortReady(4400);
            }

            if (!ready) {
              return {
                content: [
                  {
                    type: 'text',
                    text: '⚠️  Emulator start timed out after 60s. Check port 4400 manually or try again.',
                  },
                ],
                isError: true,
                details: { code: 1 },
              };
            }

            return {
              content: [{ type: 'text', text: '✅ Emulator started and responding on port 4400.' }],
              details: { code: 0 },
            };
          }
          if (params.action === 'stop') {
            // Stop only the firebase tab (preserve client/voice/image/text if running)
            const mode: AikamiMode = 'emulator';
            await stopServices({ mode, services: ['firebase'] });
            return {
              content: [{ type: 'text', text: '🛑 Emulator stopped.' }],
              details: { code: 0 },
            };
          }
          // status — check via herdr service list + port readiness
          const sessions = await listServices('emulator');
          const firebaseSession = sessions.find((s) => s.name === 'aikami-emulator');

          if (!firebaseSession || firebaseSession.services.length === 0) {
            return {
              content: [{ type: 'text', text: '⏸️  No aikami-emulator workspace running.' }],
              details: { code: 0 },
            };
          }

          const emulatorPorts = [4000, 4400, 5001, 8080, 9099, 8085, 9199, 9150, 4500, 9299, 9499];
          const portChecks = await Promise.all(
            emulatorPorts.map(async (p) => ({ port: p, ready: await isPortReady(p) })),
          );
          const active = portChecks.filter((p) => p.ready);

          if (active.length === 0) {
            const fbSvc = firebaseSession.services.find((s) => s.service === 'firebase');
            const status = fbSvc?.running ? 'booting' : 'not running';
            return {
              content: [
                {
                  type: 'text',
                  text: `⏸️  Emulator workspace exists but firebase tab is ${status}.`,
                },
              ],
              details: { code: 0 },
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `✅ **Emulator ports active**: ${active.map((p) => `:${p.port}`).join(', ')}`,
              },
            ],
            details: { code: 0, activePorts: active.map((p) => p.port) },
          };
        },
      }),
    ],
  });

  // Deploy Firebase functions

  // Start/stop Firebase emulators
}
