// .pi/extensions/direnv.ts
//
// Direnv environment awareness — reads AIKAMI_* env vars set by the project's
// .envrc / scripts/direnv/ infrastructure. All pi extensions and the LLM
// operate within a loaded direnv environment; this tool surfaces that state
// and provides mutation helpers (mode switch, package add, secret add).
//
// Env vars guaranteed by .envrc (always available):
//   AIKAMI_ROOT          — project root (git rev-parse --show-toplevel)
//   AIKAMI_MODE          — emulator | development | production
//   AIKAMI_ENV           — alias for AIKAMI_MODE
//   AIKAMI_PROJECT_ID    — GCP project id
//   AIKAMI_IS_EMULATOR   — "1" or "0"
//   AIKAMI_ENV_LOADED    — "1" if .envrc completed successfully
//   AIKAMI_NIX_READY     — "1" if Nix devShell loaded
//   PLAYWRIGHT_BROWSERS_PATH — from Nix flake
//   GEMINI_API_KEY       — from GSM or mock (emulator mode)

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "typebox"
import * as fs from "node:fs"
import * as path from "node:path"

const VALID_MODES = ["emulator", "development", "production"] as const

// ── Helpers ───────────────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return process.env[key] || undefined
}

function getRoot(): string {
  return getEnv("AIKAMI_ROOT") || process.cwd()
}

function isEmulator(): boolean {
  return getEnv("AIKAMI_IS_EMULATOR") === "1"
}

function readEnvLocal(): Record<string, string> {
  const file = path.join(getRoot(), ".env.local")
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  const lines = fs.readFileSync(file, "utf8").split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

function writeEnvLocal(key: string, value: string): void {
  const current = readEnvLocal()
  current[key] = value
  const lines = Object.entries(current).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(path.join(getRoot(), ".env.local"), lines.join("\n") + "\n")
}

// ── Tool: direnv_status ───────────────────────────────────────────────

function buildStatusReport(): string {
  const mode = getEnv("AIKAMI_MODE") || "unknown"
  const projectId = getEnv("AIKAMI_PROJECT_ID") || "unknown"
  const isEmu = isEmulator()
  const nixReady = getEnv("AIKAMI_NIX_READY") === "1" || getEnv("IN_NIX_SHELL") !== undefined
  const root = getRoot()
  const playwrightOk = getEnv("PLAYWRIGHT_BROWSERS_PATH") !== undefined
  const geminiOk = getEnv("GEMINI_API_KEY") !== undefined

  const lines: string[] = []
  lines.push("")
  lines.push("  🎴 Aikami Environment Status")
  lines.push("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  lines.push(`  Root:     ${root}`)
  lines.push(`  Mode:     ${mode}`)
  if (isEmu) {
    lines.push(`  Project:  ${projectId} (local emulators)`)
  } else {
    lines.push(`  Project:  ${projectId} (live GCP)`)
  }
  lines.push("")
  lines.push("  ── Runtime ──")
  lines.push(`  Nix Shell:  ${nixReady ? "✅ loaded" : "⚠️  not loaded — run `direnv reload`"}`)
  lines.push(`  Playwright: ${playwrightOk ? "✅ configured" : "⚠️  missing — check flake.nix"}`)
  lines.push(`  Gemini Key: ${geminiOk ? "✅ set" : "⚠️  not set (mock in emulator)"}`)
  lines.push("")
  lines.push("  ── Shell Shortcuts (bash/zsh) ──")
  lines.push("  m <target>        moon run shorthand")
  lines.push("  mf                fix affected")
  lines.push("  mc                typecheck affected")
  lines.push("  aikami_validate   fix → typecheck → build → test")
  lines.push("  aikami_switch     change mode")
  lines.push("  aikami_help       full shortcut list")
  lines.push("")
  return lines.join("\n")
}

// ── Tool: direnv_switch_mode ──────────────────────────────────────────

async function switchMode(mode: string): Promise<string> {
  writeEnvLocal("AIKAMI_MODE", mode)
  // Reload direnv via bash — this re-evaluates .envrc
  const { execSync } = await import("node:child_process")
  try {
    execSync("direnv reload", { cwd: getRoot(), stdio: "pipe", timeout: 30_000 })
  } catch {
    // direnv reload may fail in some contexts (e.g. no direnv binary in the
    // same PATH that pi was launched with). Fall back to manual env export.
    const projectMap: Record<string, string> = {
      emulator: "demo-aikami-emulator",
      development: "aikami-dev",
      production: "aikami-prod",
    }
    process.env.AIKAMI_MODE = mode
    process.env.AIKAMI_ENV = mode
    process.env.AIKAMI_PROJECT_ID = projectMap[mode] || "demo-aikami-emulator"
    process.env.AIKAMI_IS_EMULATOR = mode === "emulator" ? "1" : "0"
  }
  return `✅ Switched to ${mode} mode. Run \`direnv reload\` if env vars aren't refreshed.`
}

// ── Tool: direnv_add_package ──────────────────────────────────────────
//
// Adds a Nix package to flake.nix `devShells.default.packages` list.
// After adding, triggers direnv reload so the package is immediately
// available in the devShell.

function addNixPackage(packageName: string): string {
  const flakePath = path.join(getRoot(), "flake.nix")
  if (!fs.existsSync(flakePath)) {
    return `❌ flake.nix not found at ${flakePath}`
  }

  let content = fs.readFileSync(flakePath, "utf8")

  // Check if package already exists in the list (case-insensitive)
  const afterPackages = content.indexOf("packages = with pkgs; [")
  if (afterPackages === -1) {
    return "❌ Could not find `packages = with pkgs; [` block in flake.nix"
  }

  const bracketStart = afterPackages + "packages = with pkgs; [".length
  const bracketEnd = content.indexOf("]", bracketStart)
  if (bracketEnd === -1) {
    return "❌ Could not find closing `]` of packages list in flake.nix"
  }

  const packagesBlock = content.slice(bracketStart, bracketEnd)
  if (packagesBlock.toLowerCase().includes(packageName.toLowerCase())) {
    return `⚠️  Package '${packageName}' already exists in flake.nix — skipping.`
  }

  // Insert before the closing bracket, with proper indentation
  const indent = "          "
  const insertion = `${indent}${packageName}\n`
  content = content.slice(0, bracketEnd) + insertion + content.slice(bracketEnd)

  fs.writeFileSync(flakePath, content)

  // Trigger direnv reload so the package is available immediately
  try {
    const { execSync } = require("node:child_process")
    execSync("direnv reload", { cwd: getRoot(), stdio: "pipe", timeout: 60_000 })
  } catch {
    // Reload may time out (Nix evaluation) or fail. That's OK — the user
    // will get the package on next shell entry.
  }

  return `✅ Added \`${packageName}\` to flake.nix devShell packages.\n\n   Direnv reload triggered — the package will be available shortly.\n   If it doesn't appear, run \`direnv reload\` manually.`
}

// ── Tool: direnv_add_secret ───────────────────────────────────────────

function addSecretKey(secretKey: string): string {
  const secretsPath = path.join(getRoot(), "scripts/direnv/secrets.sh")
  if (!fs.existsSync(secretsPath)) {
    return `❌ secrets.sh not found at ${secretsPath}`
  }

  let content = fs.readFileSync(secretsPath, "utf8")

  // Find the _AIKAMI_SECRET_KEYS array
  const arrayStart = content.indexOf("_AIKAMI_SECRET_KEYS=(")
  if (arrayStart === -1) {
    return "❌ Could not find `_AIKAMI_SECRET_KEYS` array in secrets.sh"
  }

  const arrayEnd = content.indexOf(")", arrayStart)
  if (arrayEnd === -1) {
    return "❌ Could not find closing `)` of _AIKAMI_SECRET_KEYS array"
  }

  const arrayBlock = content.slice(arrayStart, arrayEnd)
  if (arrayBlock.includes(secretKey)) {
    return `⚠️  Secret key '${secretKey}' already in _AIKAMI_SECRET_KEYS — skipping.`
  }

  // Insert before the closing paren (last entry has no trailing comma in bash arrays)
  // Find the last non-comment, non-empty line before the closing )
  const lines = arrayBlock.split("\n")
  const insertion = `  ${secretKey}\n`
  content = content.slice(0, arrayEnd) + insertion + content.slice(arrayEnd)

  fs.writeFileSync(secretsPath, content)

  return `✅ Added \`${secretKey}\` to _AIKAMI_SECRET_KEYS in secrets.sh.\n\n   Next steps:\n   1. Add the secret to GCP Secret Manager: gcloud secrets create ${secretKey}\n   2. Run: aikami_secrets_refresh`
}

// ── Extension Registration ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── direnv_status ───────────────────────────────────────────────────
  pi.registerTool({
    name: "direnv_status",
    label: "Direnv: Environment Status",
    description:
      "Read Aikami direnv environment: mode (emulator/dev/prod), GCP project, "
      + "Nix shell status, Playwright config, secrets state, and shell shortcuts.",
    promptSnippet:
      "Use direnv_status to check the current environment before operations that depend on mode.",
    promptGuidelines: [
      "Use direnv_status at the start of a session to understand the environment.",
      "Use direnv_status before deploying or switching contexts.",
      "All pi tools inherit the direnv environment — AIKAMI_MODE, AIKAMI_PROJECT_ID are always set.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const report = buildStatusReport()
      return {
        content: [{ type: "text", text: report }],
        details: {
          mode: getEnv("AIKAMI_MODE") || "unknown",
          projectId: getEnv("AIKAMI_PROJECT_ID") || "unknown",
          isEmulator: isEmulator(),
          nixReady: getEnv("AIKAMI_NIX_READY") === "1",
        },
      }
    },
  })

  // ── direnv_switch_mode ──────────────────────────────────────────────
  pi.registerTool({
    name: "direnv_switch_mode",
    label: "Direnv: Switch Mode",
    description:
      "Switch Aikami environment mode (emulator, development, production). "
      + "Updates .env.local and reloads direnv so all env vars refresh.",
    promptSnippet:
      "Use direnv_switch_mode to change between emulator, development, and production environments.",
    promptGuidelines: [
      "Prefer emulator mode for local development and testing.",
      "Switch to development/production before deploying to live Firebase.",
      "After switching, firestore_query and service_logs will automatically target the new project.",
    ],
    parameters: Type.Object({
      mode: Type.String({
        description: "Target mode",
        enum: VALID_MODES as unknown as string[],
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = await switchMode(params.mode)
      return {
        content: [{ type: "text", text: result }],
        details: { mode: getEnv("AIKAMI_MODE") },
      }
    },
  })

  // ── direnv_add_package ──────────────────────────────────────────────
  pi.registerTool({
    name: "direnv_add_package",
    label: "Direnv: Add Nix Package",
    description:
      "Add a package to flake.nix devShell and reload direnv. "
      + "Use when the LLM needs a CLI tool not yet in the Nix environment "
      + "(e.g., python3, jq, ffmpeg, imagemagick). "
      + "After adding, the package is available immediately.",
    promptSnippet:
      "Use direnv_add_package to install missing CLI tools via Nix into the project devShell.",
    promptGuidelines: [
      "If a command is not found (python3, ffmpeg, jq, etc.), add it to flake.nix via direnv_add_package instead of asking the user.",
      "After adding, the package will be available in subsequent pi.exec() calls.",
      "Common nixpkgs package names: python3, jq, ffmpeg, imagemagick, curl, wget, git.",
    ],
    parameters: Type.Object({
      packageName: Type.String({
        description:
          "Nix package name (e.g. 'python3', 'jq', 'ffmpeg', 'imagemagick'). Use nixpkgs naming.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = addNixPackage(params.packageName)
      return {
        content: [{ type: "text", text: result }],
        details: { packageName: params.packageName },
      }
    },
  })

  // ── direnv_add_secret ───────────────────────────────────────────────
  pi.registerTool({
    name: "direnv_add_secret",
    label: "Direnv: Add Secret Key",
    description:
      "Register a new secret key in _AIKAMI_SECRET_KEYS list in "
      + "scripts/direnv/secrets.sh. After adding, the secret will be "
      + "pulled from GCP Secret Manager on next direnv load.",
    promptSnippet:
      "Use direnv_add_secret when a new API key or credential needs to be managed via GSM.",
    promptGuidelines: [
      "Secret keys should be UPPER_SNAKE_CASE (e.g., OPENAI_API_KEY).",
      "After adding, the user must create the secret in GCP Secret Manager.",
    ],
    parameters: Type.Object({
      secretKey: Type.String({
        description:
          "Secret key name in UPPER_SNAKE_CASE (e.g. 'OPENAI_API_KEY', 'STRIPE_SECRET')",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = addSecretKey(params.secretKey)
      return {
        content: [{ type: "text", text: result }],
        details: { secretKey: params.secretKey },
      }
    },
  })

  // ── Auto-inject: session start env banner ───────────────────────────
  pi.on("session_start", async (_event, _ctx) => {
    // Lightweight — just confirms direnv is loaded
    const mode = getEnv("AIKAMI_MODE")
    if (mode) {
      console.log(`[direnv] Aikami environment loaded: mode=${mode} project=${getEnv("AIKAMI_PROJECT_ID")}`)
    } else {
      console.log("[direnv] ⚠️  AIKAMI_MODE not set — direnv may not be loaded")
    }
  })
}
