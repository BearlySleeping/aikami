// .pi/extensions/gcloud_exec.ts
// General-purpose gcloud wrapper for pi.
//
// The point of this extension: pi should never shell out to a bare `gcloud`
// directly. Doing so trusts whatever project/account happens to be active in
// the ambient shell — which may be a personal login, the wrong mode, or
// nothing at all. This tool resolves the correct project id and the correct
// per-mode service-account credentials itself, for THIS call only, and wraps
// them around whatever gcloud command pi wants to run.
//
// mode → project id (mirrors bootstrap.sh's _AIKAMI_PROJECT_MAP /
// packages/shared/constants/src/lib/project.ts's MODE_PROJECT_MAP — kept as
// a small local copy here rather than imported, same as log_viewer.ts's own
// local APP_CONFIG, since .pi/extensions run outside the moon project graph):
//   staging     → aikami-staging
//   production  → aikami-production
//   (emulator has no real GCP project — mode must be passed explicitly
//    whenever AIKAMI_MODE is 'emulator' or unset; there's no sane default)
//
// Credentials are resolved fresh from mode on every call — NOT read from
// whatever the ambient shell's bootstrap.sh already exported. That's
// deliberate: the whole value of this tool is being correct regardless of
// what mode the interactive shell happens to be sitting in right now.
// See bootstrap.sh's _aikami_load_gcp_credentials for the local-dev
// counterpart of this same idea:
//   GOOGLE_APPLICATION_CREDENTIALS          → ADC, read by @google-cloud/*,
//                                              firebase-admin, google-auth-library
//   CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE  → the gcloud CLI's OWN active
//                                              credential (gcloud does NOT
//                                              read GOOGLE_APPLICATION_CREDENTIALS
//                                              for its own commands)
// Both are set only for the single `env VAR=val ... gcloud ...` child
// process below — never exported into pi's own environment.
//
// Direnv env vars (set by .envrc) — always available:
//   AIKAMI_MODE   — emulator | staging | production
//   AIKAMI_ROOT   — repo root (used to locate .secrets/gcp_sa_key.<mode>.json)

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { smartTruncate } from './lib/output_filter';

type Mode = 'staging' | 'production';

const MODE_PROJECT_MAP: Record<Mode, string> = {
  staging: 'aikami-staging',
  production: 'aikami-production',
};

/**
 * Heuristic only — a keyword match on the raw command string, not a real
 * permissions/allowlist check. Exists so an agent can't fire off an
 * irreversible `gcloud ... delete` with zero friction, not to guarantee
 * safety. False positives just cost one extra `confirm: true`; some
 * destructive commands may not match this and won't be caught.
 */
const DESTRUCTIVE_PATTERN = /\b(delete|remove|destroy|undeploy|revoke|purge|disable)\b/i;

type ModeResolution = { mode: Mode; source: 'param' | 'env' };

function resolveMode(explicit: string | undefined): ModeResolution | { error: string } {
  if (explicit === 'staging' || explicit === 'production') {
    return { mode: explicit, source: 'param' };
  }
  if (explicit) {
    return { error: `Invalid mode "${explicit}". Must be 'staging' or 'production'.` };
  }
  const envMode = process.env.AIKAMI_MODE;
  if (envMode === 'staging' || envMode === 'production') {
    return { mode: envMode, source: 'env' };
  }
  return {
    error:
      `mode is required — AIKAMI_MODE is currently ${envMode ? `'${envMode}'` : 'unset'}, ` +
      `which doesn't select a real GCP project. Pass mode: 'staging' or 'production'.`,
  };
}

function resolveSaKeyPath(mode: Mode): string {
  const root = process.env.AIKAMI_ROOT ?? process.cwd();
  // Deliberately NOT honoring AIKAMI_GCP_SA_KEY_PATH here (unlike
  // bootstrap.sh's _aikami_load_gcp_credentials): that override is a single
  // flat path with no per-mode meaning, and this tool's entire value is
  // resolving credentials for the REQUESTED mode regardless of the shell's
  // ambient AIKAMI_MODE — honoring a mode-agnostic override would undercut
  // that guarantee.
  return join(root, '.secrets', `gcp_sa_key.${mode}.json`);
}

/**
 * Minimal shell-word tokenizer: splits on whitespace, honors single/double
 * quotes and backslash escapes. Good enough for gcloud's own flag syntax
 * (`--filter="severity>=ERROR"`, `--format=json`, etc.) without needing a
 * real shell — this never touches a shell, so there's no injection surface
 * from the free-form command string.
 */
function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in command string`);
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export default function (pi: ExtensionAPI) {
  const DefaultTimeout = 180_000; // 3 min — matches log_viewer.ts

  pi.registerTool({
    name: 'gcloud_exec',
    label: 'GCP: Run gcloud Command',
    description:
      'Run any gcloud command against an Aikami GCP project (staging or production), ' +
      'with the correct project id and per-mode service-account credentials resolved ' +
      "and injected automatically — no reliance on the ambient shell's gcloud config or " +
      'personal login. Use this instead of running `gcloud` directly.',
    promptSnippet:
      "Use gcloud_exec for any gcloud command against Aikami's GCP projects — it resolves " +
      'the right project id and credentials for the mode automatically.',
    promptGuidelines: [
      'ALWAYS use gcloud_exec instead of running `gcloud` directly in the shell — a bare ' +
        '`gcloud` call may hit the wrong project or your personal login instead of the ' +
        "mode's dedicated service account.",
      "mode defaults to AIKAMI_MODE when that's 'staging' or 'production'; if AIKAMI_MODE " +
        "is 'emulator' or unset, mode must be passed explicitly — gcloud has no meaning " +
        'for the emulator.',
      'Pass command WITHOUT the leading "gcloud" word, e.g. ' +
        '"run services describe client --region=europe-west1" — a leading "gcloud" is ' +
        'tolerated and stripped automatically. --project and --quiet are added ' +
        'automatically unless the command already includes them.',
      'Destructive-looking commands (delete/remove/destroy/undeploy/revoke/purge/disable) ' +
        'are blocked until confirm: true is passed — surface that requirement to the user ' +
        'and let them decide, rather than setting confirm: true yourself.',
      'Use dryRun: true first for anything unfamiliar, high-stakes, or destructive, to see ' +
        'the fully-resolved command (project, credentials, final args) before it can ' +
        'actually run anything.',
      'For Aikami service logs specifically, prefer service_logs — it already routes to ' +
        'the right gcloud/firestack invocation with sensible defaults (--tail, --since, etc).',
    ],
    parameters: Type.Object({
      mode: Type.Optional(
        Type.String({
          description:
            "GCP project to target: 'staging' or 'production'. Defaults to AIKAMI_MODE " +
            "when that's staging or production; must be passed explicitly otherwise " +
            '(e.g. when the shell is currently in emulator mode).',
          enum: ['staging', 'production'],
        }),
      ),
      command: Type.String({
        description:
          'The gcloud command to run, WITHOUT the leading "gcloud" ' +
          '(e.g. "run services describe client --region=europe-west1"). A leading ' +
          '"gcloud" is tolerated and stripped. --project and --quiet are appended ' +
          'automatically unless already present.',
      }),
      confirm: Type.Optional(
        Type.Boolean({
          description:
            'Must be true to run a command that looks destructive ' +
            '(delete/remove/destroy/undeploy/revoke/purge/disable).',
          default: false,
        }),
      ),
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            'If true, resolve and print the command (mode, project, credentials, final ' +
            'args) without executing anything.',
          default: false,
        }),
      ),
      timeout: Type.Optional(
        Type.Number({
          description:
            'Timeout in milliseconds before the command is killed. Default 180000 (3 min).',
          default: 180_000,
          minimum: 1,
          maximum: 600_000, // 10 min — well under the 32-bit signed int ms limit
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const modeResult = resolveMode(params.mode);
      if ('error' in modeResult) {
        return {
          content: [{ type: 'text', text: modeResult.error }],
          details: { code: 1, source: 'unknown_mode' },
        };
      }
      const { mode, source: modeSource } = modeResult;
      const projectId = MODE_PROJECT_MAP[mode];

      const rawCommand = (params.command ?? '').trim();
      if (!rawCommand) {
        return {
          content: [
            {
              type: 'text',
              text: 'command is required, e.g. "run services describe client --region=europe-west1".',
            },
          ],
          details: { code: 1, source: 'missing_command' },
        };
      }

      let tokens: string[];
      try {
        tokens = tokenizeCommand(rawCommand);
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Could not parse command: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { code: 1, source: 'parse_error' },
        };
      }
      if (tokens[0] === 'gcloud') {
        tokens = tokens.slice(1);
      }
      if (tokens.length === 0) {
        return {
          content: [{ type: 'text', text: 'command is empty after stripping "gcloud".' }],
          details: { code: 1, source: 'missing_command' },
        };
      }

      const normalizedCommand = tokens.join(' ');
      const destructiveMatch = DESTRUCTIVE_PATTERN.exec(normalizedCommand);
      if (destructiveMatch && !params.confirm) {
        return {
          content: [
            {
              type: 'text',
              text:
                `"${destructiveMatch[0]}" looks destructive. Re-run with confirm: true to ` +
                'proceed — surface this to the user first rather than setting it yourself.',
            },
          ],
          details: { code: 1, source: 'confirm_required', matched: destructiveMatch[0] },
        };
      }

      const hasProjectFlag = tokens.some((t) => t === '--project' || t.startsWith('--project='));
      if (hasProjectFlag) {
        return {
          content: [
            {
              type: 'text',
              text:
                'Caller-provided --project flag is not allowed. This tool always injects the ' +
                `correct project (${projectId}) for the requested mode (${mode}). Remove the ` +
                '--project flag from your command and let this tool set it automatically.',
            },
          ],
          details: { code: 1, source: 'project_flag_rejected' },
        };
      }
      const hasQuietFlag = tokens.some((t) => t === '--quiet' || t === '-q');
      const finalArgs = [...tokens];
      finalArgs.push('--project', projectId);
      if (!hasQuietFlag) {
        // Non-interactive by construction — there's no TTY for pi to answer
        // a `y/N` prompt, so an unconfirmed prompt would just hang until
        // `timeout`. The confirm gate above is the real safety check; this
        // just prevents a silent hang on top of it.
        finalArgs.push('--quiet');
      }

      const keyPath = resolveSaKeyPath(mode);

      if (params.dryRun) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `mode:        ${mode} (${modeSource})`,
                `project:     ${projectId}`,
                `credentials: ${keyPath}`,
                `would run:   gcloud ${finalArgs.join(' ')}`,
              ].join('\n'),
            },
          ],
          details: { code: 0, source: 'dry_run', mode, projectId },
        };
      }

      if (!existsSync(keyPath)) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No service-account key at ${keyPath}. See bootstrap.sh's ` +
                '_aikami_load_gcp_credentials for how this is supposed to get there.',
            },
          ],
          details: { code: 1, source: 'missing_credentials' },
        };
      }

      const rawTimeout = params.timeout ?? DefaultTimeout;
      const timeout = Math.min(Math.max(rawTimeout, 1), 600_000);
      const result = await pi.exec(
        'env',
        [
          `GOOGLE_APPLICATION_CREDENTIALS=${keyPath}`,
          `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=${keyPath}`,
          'gcloud',
          ...finalArgs,
        ],
        { signal, timeout },
      );

      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      const raw =
        stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr || '';
      return {
        content: [{ type: 'text', text: smartTruncate(raw, 100) }],
        details: { code: result.code, source: 'gcloud', mode, projectId },
      };
    },
  });
}
