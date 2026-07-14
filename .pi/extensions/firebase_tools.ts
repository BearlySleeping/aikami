// .pi/extensions/firebase_tools.ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  type AikamiMode,
  isPortReady,
  listServices,
  startServices,
  stopServices,
} from '../../scripts/src/lib/herdr/session';
// Direnv env vars (set by .envrc / scripts/direnv/) — always available:
//   AIKAMI_MODE          — emulator | staging | production
//   AIKAMI_PROJECT_ID    — GCP project id (demo-aikami-emulator | aikami-dev | aikami-prod)
import { smartTruncate } from './lib/output_filter';

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
  pi.registerTool({
    name: 'firestore_query',
    label: 'Firestore: Query Collection',
    description:
      'Queries a Firestore collection via the admin SDK. Uses emulator when env=emulator, or live GCP project for staging/production.',
    promptSnippet: 'Use firestore_query to inspect Firestore data during debugging.',
    promptGuidelines: [
      'Use firestore_query to peek at Firestore data instead of reading raw emulator exports.',
    ],
    parameters: Type.Object({
      collection: Type.String({
        description: "Firestore collection path, e.g. 'users' or 'configs/site'",
      }),
      limit: Type.Optional(Type.Number({ description: 'Max documents to return', default: 10 })),
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
      const mode = params.env ?? (process.env.AIKAMI_MODE as Mode | undefined) ?? 'emulator';
      if (mode === 'emulator') {
        const result = await pi.exec(
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
          { signal, timeout: DefaultTimeout },
        );
        return {
          content: [{ type: 'text', text: result.stdout || result.stderr }],
          details: { code: result.code },
        };
      }
      const projectId = getProjectId(mode as Mode);
      const result = await pi.exec(
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
        { signal, timeout: DefaultTimeout },
      );
      return {
        content: [{ type: 'text', text: result.stdout || result.stderr }],
        details: { code: result.code, projectId, mode },
      };
    },
  });

  // Deploy Firebase functions
  pi.registerTool({
    name: 'firebase_deploy_functions',
    label: 'Firebase: Deploy Cloud Functions',
    description: 'Builds and deploys Cloud Functions to the specified mode via firestack.',
    promptSnippet: 'Use firebase_deploy_functions to deploy backend functions to Firebase.',
    promptGuidelines: [
      'Use firebase_deploy_functions after making changes to Cloud Functions.',
      'Run moon_detect_affected first to confirm functions project needs deployment.',
    ],
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
      const result = await pi.exec('env', args, { signal, timeout: HeavyTimeout });
      const raw = result.stdout || result.stderr || '';
      const filtered = raw.length > 8000 ? smartTruncate(raw, 80) : raw;
      return {
        content: [{ type: 'text', text: filtered }],
        details: { code: result.code, mode, only: params.only },
      };
    },
  });

  // Start/stop Firebase emulators
  pi.registerTool({
    name: 'firebase_emulator',
    label: 'Firebase: Start/Stop Emulators',
    description: 'Controls the local Firebase emulator suite. Start, stop, or check status.',
    promptSnippet: 'Use firebase_emulator to manage local Firebase emulators.',
    promptGuidelines: [
      'Use firebase_emulator start before running local E2E tests or developing against local backend.',
    ],
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
  });
}
