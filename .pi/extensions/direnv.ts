// .pi/extensions/direnv.ts
//
// Direnv environment awareness — reads AIKAMI_* env vars set by the project's
// .envrc / scripts/direnv/ infrastructure. All pi extensions and the LLM
// operate within a loaded direnv environment; this tool surfaces that state
// and provides mutation helpers (mode switch, package add, secret add).
//
// Non-direnv machines (see scripts/src/lib/env/direnv_detect.ts) get a
// graceful fallback: mode/project are derived from .env.local, switching
// mode updates .env.local + this process's env, and the nix-only tools
// (add_package/add_secret) explain why they need direnv.
//
// Env vars guaranteed by .envrc (always available):
//   AIKAMI_ROOT          — project root (git rev-parse --show-toplevel)
//   AIKAMI_MODE          — emulator | staging | production
//   AIKAMI_ENV           — alias for AIKAMI_MODE
//   AIKAMI_PROJECT_ID    — GCP project id
//   AIKAMI_IS_EMULATOR   — "1" or "0"
//   AIKAMI_ENV_LOADED    — "1" if .envrc completed successfully
//   AIKAMI_NIX_READY     — "1" if Nix devShell loaded
//   PLAYWRIGHT_BROWSERS_PATH — from Nix flake
//   GEMINI_API_KEY       — from GSM or mock (emulator mode)

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  hasDirenv,
  isDirenvLoaded,
  resolveAikamiEnv,
} from '../../scripts/src/lib/env/direnv_detect';
import { runSync } from './lib/process_runner.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

const VALID_MODES = ['emulator', 'staging', 'production'] as const;

// ── Helpers ───────────────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

function getRoot(): string {
  return getEnv('AIKAMI_ROOT') || process.cwd();
}

function readEnvLocal(): Record<string, string> {
  const file = path.join(getRoot(), '.env.local');
  if (!fs.existsSync(file)) {
    return {};
  }
  const out: Record<string, string> = {};
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function writeEnvLocal(key: string, value: string): void {
  const current = readEnvLocal();
  current[key] = value;
  const lines = Object.entries(current).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(path.join(getRoot(), '.env.local'), `${lines.join('\n')}\n`);
}

// ── Tool: direnv_status ───────────────────────────────────────────────

function buildStatusReport(): string {
  // Non-direnv machines: derive mode/project from .env.local so the status
  // is accurate even when .envrc never ran.
  const env = resolveAikamiEnv(getRoot());
  const mode = getEnv('AIKAMI_MODE') || env.mode;
  const projectId = getEnv('AIKAMI_PROJECT_ID') || env.projectId;
  const isEmu = mode === 'emulator';
  const nixReady = isDirenvLoaded();
  const direnvPresent = hasDirenv();
  const root = getRoot();
  const playwrightOk = getEnv('PLAYWRIGHT_BROWSERS_PATH') !== undefined;
  const geminiOk = getEnv('GEMINI_API_KEY') !== undefined;

  let nixLine: string;
  if (nixReady) {
    nixLine = '✅ loaded';
  } else if (direnvPresent) {
    nixLine = '⚠️  not loaded — run `direnv reload`';
  } else {
    nixLine = '— not installed (manual env via .env.local)';
  }

  const lines: string[] = [];
  lines.push('');
  lines.push('  🎴 Aikami Environment Status');
  lines.push('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  Root:     ${root}`);
  lines.push(`  Mode:     ${mode}`);
  if (isEmu) {
    lines.push(`  Project:  ${projectId} (local emulators)`);
  } else {
    lines.push(`  Project:  ${projectId} (live GCP)`);
  }
  lines.push('');
  lines.push('  ── Runtime ──');
  lines.push(`  Nix Shell:  ${nixLine}`);
  lines.push(`  Playwright: ${playwrightOk ? '✅ configured' : '⚠️  missing — check flake.nix'}`);
  lines.push(`  Gemini Key: ${geminiOk ? '✅ set' : '⚠️  not set (mock in emulator)'}`);
  lines.push('');
  lines.push('  ── Shell Shortcuts (bash/zsh) ──');
  lines.push('  m <target>        moon run shorthand');
  lines.push('  mf                fix affected');
  lines.push('  mc                typecheck affected');
  lines.push('  aikami_validate   fix → typecheck → build → test');
  lines.push('  aikami_switch     change mode');
  lines.push('  aikami_help       full shortcut list');
  lines.push('');
  return lines.join('\n');
}

// ── Tool: direnv_switch_mode ──────────────────────────────────────────

async function switchMode(mode: string): Promise<string> {
  writeEnvLocal('AIKAMI_MODE', mode);

  let reloadFailed = false;
  if (hasDirenv()) {
    // Reload direnv via bash — this re-evaluates .envrc. runSync returns a
    // result (it does not throw on non-zero exit), so treat any non-zero
    // code as a failed reload rather than reporting success.
    try {
      const reload = runSync('direnv', ['reload'], { cwd: getRoot(), timeoutMs: 30_000 });
      reloadFailed = reload.code !== 0;
    } catch {
      // Reload failed (slow Nix eval, non-interactive context) — fall
      // through to the in-process env update below so this session still
      // sees the new mode.
      reloadFailed = true;
    }
  }

  // Always update in-process env from the authoritative mode→project map —
  // direnv reload only affects new shells, so this pi session needs the
  // env applied regardless of whether the reload succeeded. New shells read
  // AIKAMI_MODE from .env.local anyway.
  const env = resolveAikamiEnv(getRoot());
  process.env.AIKAMI_MODE = env.mode;
  process.env.AIKAMI_ENV = env.mode;
  process.env.AIKAMI_PROJECT_ID = env.projectId;
  process.env.AIKAMI_IS_EMULATOR = env.isEmulator ? '1' : '0';

  let applyNote: string;
  if (hasDirenv()) {
    if (reloadFailed) {
      applyNote =
        'direnv reload failed — run `direnv reload` to refresh env vars; env updated in this session.';
    } else {
      applyNote = "Run `direnv reload` if env vars aren't refreshed.";
    }
  } else {
    applyNote =
      'direnv not installed — new shells read .env.local automatically; env updated in this session.';
  }
  return `✅ Switched to ${mode} mode. ${applyNote}`;
}

// ── Tool: direnv_add_package ──────────────────────────────────────────
//
// Adds a Nix package to flake.nix `devShells.default.packages` list.
// After adding, triggers direnv reload so the package is immediately
// available in the devShell.

function addNixPackage(packageName: string): string {
  if (!hasDirenv()) {
    return (
      '❌ direnv not installed — flake.nix packages only take effect via the ' +
      'Nix devShell (loaded by direnv). Install tools manually instead ' +
      '(see `bun run setup`).'
    );
  }
  const flakePath = path.join(getRoot(), 'flake.nix');
  if (!fs.existsSync(flakePath)) {
    return `❌ flake.nix not found at ${flakePath}`;
  }

  let content = fs.readFileSync(flakePath, 'utf8');

  // Check if package already exists in the list (case-insensitive)
  const afterPackages = content.indexOf('packages = with pkgs; [');
  if (afterPackages === -1) {
    return '❌ Could not find `packages = with pkgs; [` block in flake.nix';
  }

  const bracketStart = afterPackages + 'packages = with pkgs; ['.length;
  const bracketEnd = content.indexOf(']', bracketStart);
  if (bracketEnd === -1) {
    return '❌ Could not find closing `]` of packages list in flake.nix';
  }

  const packagesBlock = content.slice(bracketStart, bracketEnd);
  if (packagesBlock.toLowerCase().includes(packageName.toLowerCase())) {
    return `⚠️  Package '${packageName}' already exists in flake.nix — skipping.`;
  }

  // Insert before the closing bracket, with proper indentation
  const indent = '          ';
  const insertion = `${indent}${packageName}\n`;
  content = content.slice(0, bracketEnd) + insertion + content.slice(bracketEnd);

  fs.writeFileSync(flakePath, content);

  // Trigger direnv reload so the package is available immediately
  try {
    runSync('direnv', ['reload'], { cwd: getRoot(), timeoutMs: 60_000 });
  } catch {
    // Reload may time out (Nix evaluation) or fail. That's OK — the user
    // will get the package on next shell entry.
  }

  return `✅ Added \`${packageName}\` to flake.nix devShell packages.\n\n   Direnv reload triggered — the package will be available shortly.\n   If it doesn't appear, run \`direnv reload\` manually.`;
}

// ── Tool: direnv_add_secret ───────────────────────────────────────────

function addSecretKey(secretKey: string): string {
  if (!hasDirenv()) {
    return (
      '❌ direnv not installed — secrets.sh is loaded by .envrc, so secrets ' +
      'only apply inside a direnv/Nix environment. Without direnv, set the ' +
      'secret as a plain environment variable or in scripts/.env.<mode>.'
    );
  }
  const secretsPath = path.join(getRoot(), 'scripts/direnv/secrets.sh');
  if (!fs.existsSync(secretsPath)) {
    return `❌ secrets.sh not found at ${secretsPath}`;
  }

  let content = fs.readFileSync(secretsPath, 'utf8');

  // Find the _AIKAMI_SECRET_KEYS array
  const arrayStart = content.indexOf('_AIKAMI_SECRET_KEYS=(');
  if (arrayStart === -1) {
    return '❌ Could not find `_AIKAMI_SECRET_KEYS` array in secrets.sh';
  }

  const arrayEnd = content.indexOf(')', arrayStart);
  if (arrayEnd === -1) {
    return '❌ Could not find closing `)` of _AIKAMI_SECRET_KEYS array';
  }

  const arrayBlock = content.slice(arrayStart, arrayEnd);
  if (arrayBlock.includes(secretKey)) {
    return `⚠️  Secret key '${secretKey}' already in _AIKAMI_SECRET_KEYS — skipping.`;
  }

  // Insert before the closing paren (last entry has no trailing comma in bash arrays)
  const insertion = `  ${secretKey}\n`;
  content = content.slice(0, arrayEnd) + insertion + content.slice(arrayEnd);

  fs.writeFileSync(secretsPath, content);

  return `✅ Added \`${secretKey}\` to _AIKAMI_SECRET_KEYS in secrets.sh.\n\n   Next steps:\n   1. Add the secret to GCP Secret Manager: gcloud secrets create ${secretKey}\n   2. Run: aikami_secrets_refresh`;
}

// ── Extension Registration ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── direnv_status ───────────────────────────────────────────────────
  registerNamespace(pi, {
    name: 'direnv',
    label: 'Direnv Environment',
    description: 'Inspect and change the Aikami direnv environment (mode, Nix packages, secrets).',
    actions: [
      defineAction({
        action: 'status',
        summary: 'Show mode, GCP project, Nix shell and secrets',

        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
          const report = buildStatusReport();
          const env = resolveAikamiEnv(getRoot());
          return {
            content: [{ type: 'text', text: report }],
            details: {
              mode: getEnv('AIKAMI_MODE') || env.mode,
              projectId: getEnv('AIKAMI_PROJECT_ID') || env.projectId,
              // Derive from the resolved mode value so staging → false and
              // emulator → true consistently with `mode`/`projectId`.
              isEmulator: (getEnv('AIKAMI_MODE') || env.mode) === 'emulator',
              nixReady: getEnv('AIKAMI_NIX_READY') === '1' || getEnv('IN_NIX_SHELL') !== undefined,
            },
          };
        },
      }),
      defineAction({
        action: 'switch_mode',
        summary: 'Switch between emulator, staging and production',

        parameters: Type.Object({
          mode: Type.String({
            description: 'Target mode',
            enum: VALID_MODES as unknown as string[],
          }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const result = await switchMode(params.mode);
          return {
            content: [{ type: 'text', text: result }],
            details: { mode: getEnv('AIKAMI_MODE') },
          };
        },
      }),
      defineAction({
        action: 'add_package',
        summary: 'Add a Nix package to flake.nix and reload',

        parameters: Type.Object({
          packageName: Type.String({
            description:
              "Nix package name (e.g. 'python3', 'jq', 'ffmpeg', 'imagemagick'). Use nixpkgs naming.",
          }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const result = addNixPackage(params.packageName);
          return {
            content: [{ type: 'text', text: result }],
            details: { packageName: params.packageName },
          };
        },
      }),
      defineAction({
        action: 'add_secret',
        summary: 'Register a new secret key in secrets.sh',

        parameters: Type.Object({
          secretKey: Type.String({
            description:
              "Secret key name in UPPER_SNAKE_CASE (e.g. 'OPENAI_API_KEY', 'STRIPE_SECRET')",
          }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const result = addSecretKey(params.secretKey);
          return {
            content: [{ type: 'text', text: result }],
            details: { secretKey: params.secretKey },
          };
        },
      }),
    ],
  });

  // ── direnv_switch_mode ──────────────────────────────────────────────

  // ── direnv_add_package ──────────────────────────────────────────────

  // ── direnv_add_secret ───────────────────────────────────────────────

  // ── Auto-inject: session start env banner ───────────────────────────
  pi.on('session_start', async (_event, _ctx) => {
    // Lightweight — just confirms direnv is loaded
    const mode = getEnv('AIKAMI_MODE');
    if (mode) {
    } else {
    }
  });
}
