// .pi/extensions/firebase_tools.ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// Direnv env vars (set by .envrc / scripts/direnv/) — always available:
//   AIKAMI_MODE          — emulator | staging | production
//   AIKAMI_PROJECT_ID    — GCP project id (demo-aikami-emulator | aikami-dev | aikami-prod)
import { smartTruncate } from './lib/output-filter';

const MODES = ['staging', 'production'] as const;
type Mode = (typeof MODES)[number];

/** Resolve GCP project id from direnv env; fall back to known defaults */
function getProjectId(mode: Mode): string {
  return process.env.AIKAMI_PROJECT_ID ?? (mode === 'staging' ? 'aikami-dev' : 'aikami-prod');
}

export default function (pi: ExtensionAPI) {
  const DefaultTimeout = 180_000; // 3 min
  const HeavyTimeout = 300_000; // 5 min (deploys, emulator starts)
  const QuickTimeout = 10_000; // 10s (healthchecks, status queries)
  const TmuxTimeout = 30_000; // 30s (tmux operations)

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
        const checkResult = await pi.exec(
          'bash',
          [
            '-c',
            "curl -s -o /dev/null -w '%{http_code}' http://localhost:4400 2>/dev/null || echo '000'",
          ],
          { signal, timeout: QuickTimeout },
        );
        if (checkResult.stdout?.trim() === '200') {
          return {
            content: [
              { type: 'text', text: '✅ Emulator already running (port 4400 responding).' },
            ],
            details: { code: 0, alreadyRunning: true },
          };
        }

        // Delegate to tmux (same session as tmux-orchestrator.ts — aikami-dev:1).
        // Uses identical commands to avoid session/window conflicts.
        _onUpdate?.({
          content: [{ type: 'text', text: 'Starting emulator in tmux session aikami-dev:1...' }],
          details: {},
        });
        await pi.exec(
          'bash',
          [
            '-c',
            [
              'tmux has-session -t aikami-dev 2>/dev/null || tmux new-session -d -s aikami-dev -c "$(pwd)" -n main',
              'W=$(tmux list-windows -t aikami-dev -F "#{window_index}" 2>/dev/null)',
              'echo "$W" | grep -qx "1" || tmux new-window -d -t aikami-dev -n emulator -c "$(pwd)" "bun emulate:backend"',
            ].join(' && '),
          ],
          { signal, timeout: TmuxTimeout },
        );

        // Poll for readiness (up to 60s)
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          if (signal?.aborted) {
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
          const poll = await pi.exec(
            'bash',
            [
              '-c',
              "curl -s -o /dev/null -w '%{http_code}' http://localhost:4400 2>/dev/null || echo '000'",
            ],
            { signal, timeout: 3000 },
          );
          if (poll.stdout?.trim() === '200') {
            ready = true;
          }
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
        // Only kill the emulator window, not the entire session.
        // Checking if window 1 is the ONLY window — if so, kill session.
        const check = await pi.exec(
          'bash',
          ['-c', "tmux list-windows -t aikami-dev -F '#{window_index}' 2>/dev/null"],
          { signal, timeout: TmuxTimeout },
        );
        const windows = (check.stdout || '').split('\n').filter(Boolean);
        if (windows.length <= 1) {
          // Only emulator window (or none) — safe to kill session
          await pi.exec('bash', ['-c', 'tmux kill-session -t aikami-dev 2>/dev/null; true'], {
            signal,
            timeout: TmuxTimeout,
          });
        } else {
          // Other services running (client, vm-controller) — only kill window 1
          await pi.exec('bash', ['-c', 'tmux kill-window -t aikami-dev:1 2>/dev/null; true'], {
            signal,
            timeout: TmuxTimeout,
          });
        }
        // Also stop any orphaned emulator processes
        await pi
          .exec('bun', ['firebase', 'emulators:stop'], { signal, timeout: TmuxTimeout })
          .catch(() => {});
        return {
          content: [{ type: 'text', text: '🛑 Emulator stopped.' }],
          details: { code: 0 },
        };
      }
      // status — use ss (portable Linux) instead of lsof (missing on NixOS)
      const result = await pi.exec(
        'ss',
        [
          '-tlnp',
          '( sport = :4000 or sport = :4400 or sport = :5001 or sport = :8080 or sport = :9099 or sport = :8085 or sport = :9199 or sport = :9150 or sport = :4500 or sport = :9299 or sport = :9499 )',
        ],
        { signal, timeout: QuickTimeout },
      );
      const raw = result.stdout || result.stderr || '';
      // Parse ss output into compact summary
      const EmulatorPorts: Record<string, string> = {
        '4000': 'Firestore',
        '4400': 'Emulator UI',
        '5001': 'Hosting',
        '8080': 'Pub/Sub',
        '9099': 'Auth',
        '8085': 'Cloud Tasks',
        '9199': 'Storage',
        '9150': 'Dataconnect',
        '4500': 'Data Connect',
        '9299': 'Eventarc',
        '9499': 'Extensions',
      };
      const lines = raw.split('\n').filter(Boolean);
      const active: string[] = [];
      for (const port of Object.keys(EmulatorPorts)) {
        if (lines.some((l) => l.includes(`:${port}`))) {
          active.push(`${EmulatorPorts[port]} (:${port})`);
        }
      }
      const text =
        active.length > 0
          ? `✅ **Emulator ports active**: ${active.join(', ')}`
          : '⏸️  No emulator ports detected';
      return {
        content: [{ type: 'text', text }],
        details: { code: result.code, activePorts: active },
      };
    },
  });
}
