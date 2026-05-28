// .pi/extensions/firebase-tools.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "typebox"

// Stub: Replace with @aikami/constants after C-005 packages/shared refactor
const MODES = ["development", "production"] as const
type Mode = (typeof MODES)[number]
const MODE_PROJECT_MAP: Record<Mode, string> = {
  development: process.env.FIREBASE_PROJECT_ID ?? "aikami-dev",
  production: process.env.FIREBASE_PROJECT_ID ?? "aikami-prod",
}

export default function (pi: ExtensionAPI) {
  // Query Firestore directly from pi
  pi.registerTool({
    name: "firestore_query",
    label: "Firestore: Query Collection",
    description:
      "Queries a Firestore collection via the admin SDK. Uses emulator when env=emulator, or live GCP project for development/production.",
    promptSnippet:
      "Use firestore_query to inspect Firestore data during debugging.",
    promptGuidelines: [
      "Use firestore_query to peek at Firestore data instead of reading raw emulator exports.",
      "Query 'log_entries' for structured client-side logs (level, context.source, metadata).",
    ],
    parameters: Type.Object({
      collection: Type.String({
        description: "Firestore collection path, e.g. 'users' or 'configs/site'",
      }),
      limit: Type.Optional(
        Type.Number({ description: "Max documents to return", default: 10 })
      ),
      env: Type.Optional(
        Type.String({
          description: "Target environment",
          enum: MODES as unknown as string[],
          default: "emulator",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const mode = (params.env) ?? "emulator"
      if (mode === "emulator") {
        const result = await pi.exec("bun", [
          "run",
          "scripts/temp/firestore_query.ts",
          "--collection",
          params.collection,
          "--limit",
          String(params.limit ?? 10),
          "--emulator",
        ], { signal })
        return {
          content: [{ type: "text", text: result.stdout || result.stderr }],
          details: { code: result.code },
        }
      }
      const projectId = MODE_PROJECT_MAP[mode]
      const result = await pi.exec("bun", [
        "run",
        "scripts/temp/firestore_query.ts",
        "--collection",
        params.collection,
        "--limit",
        String(params.limit ?? 10),
        "--project",
        projectId,
      ], { signal })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code, projectId },
      }
    },
  })

  // Deploy Firebase functions
  pi.registerTool({
    name: "firebase_deploy_functions",
    label: "Firebase: Deploy Cloud Functions",
    description:
      "Builds and deploys Cloud Functions to the specified mode via firestack.",
    promptSnippet:
      "Use firebase_deploy_functions to deploy backend functions to Firebase.",
    promptGuidelines: [
      "Use firebase_deploy_functions after making changes to Cloud Functions.",
      "Run moon_detect_affected first to confirm functions project needs deployment.",
    ],
    parameters: Type.Object({
      mode: Type.Optional(
        Type.String({
          description: "Deployment mode",
          enum: ["development", "production"],
          default: "development",
        })
      ),
      only: Type.Optional(
        Type.String({
          description: "Deploy specific functions only (comma-separated names). Passes --only to firestack. Skips rules automatically.",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const mode = params.mode ?? "development"
      const args = ["bun", "moon", "run", "functions:deploy", "--", mode]
      if (params.only) args.push("--only", params.only)
      const result = await pi.exec("env", args, { signal })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code, mode, only: params.only },
      }
    },
  })

// Start/stop Firebase emulators
  pi.registerTool({
    name: "firebase_emulator",
    label: "Firebase: Start/Stop Emulators",
    description:
      "Controls the local Firebase emulator suite. Start, stop, or check status.",
    promptSnippet:
      "Use firebase_emulator to manage local Firebase emulators.",
    promptGuidelines: [
      "Use firebase_emulator start before running local E2E tests or developing against local backend.",
    ],
    parameters: Type.Object({
      action: Type.String({
        description: "Action to perform",
        enum: ["start", "stop", "status"],
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (params.action === "start") {
        // Check if emulator is already running (port 4400 = emulator UI)
        const checkResult = await pi.exec("bash", ["-c", "curl -s -o /dev/null -w '%{http_code}' http://localhost:4400 2>/dev/null || echo '000'"], { signal })
        if (checkResult.stdout?.trim() === "200") {
          return {
            content: [{ type: "text", text: "✅ Emulator already running (port 4400 responding).\n\nRead logs: tmux_session read emulator\nAttach: tmux select-window -t nordclaw-dev:1" }],
            details: { code: 0, alreadyRunning: true },
          }
        }

        // Delegate to tmux (same session as tmux-orchestrator.ts — nordclaw-dev:1).
        // Uses identical commands to avoid session/window conflicts.
        _onUpdate?.({ content: [{ type: "text", text: "Starting emulator in tmux session nordclaw-dev:1..." }] })
        await pi.exec("bash", ["-c", [
          'tmux has-session -t nordclaw-dev 2>/dev/null || tmux new-session -d -s nordclaw-dev -c "$(pwd)" -n main',
          'W=$(tmux list-windows -t nordclaw-dev -F "#{window_index}" 2>/dev/null)',
          'echo "$W" | grep -qx "1" || tmux new-window -d -t nordclaw-dev -n emulator -c "$(pwd)" "bun emulate:backend"',
        ].join(" && ")], { signal })

        // Poll for readiness (up to 60s)
        let ready = false
        for (let i = 0; i < 30 && !ready; i++) {
          if (signal.aborted) break
          await new Promise((r) => setTimeout(r, 2000))
          const poll = await pi.exec("bash", ["-c", "curl -s -o /dev/null -w '%{http_code}' http://localhost:4400 2>/dev/null || echo '000'"], { signal, timeout: 3000 })
          if (poll.stdout?.trim() === "200") ready = true
        }

        if (!ready) {
          return {
            content: [{ type: "text", text: "⚠️  Emulator start timed out after 60s.\nCheck: tmux select-window -t nordclaw-dev:1\nOr: tmux_session read emulator" }],
            isError: true,
            details: { code: 1 },
          }
        }

        return {
          content: [{ type: "text", text: "✅ Emulator started in tmux (nordclaw-dev:1).\nRead logs: tmux_session read emulator\nAttach: tmux select-window -t nordclaw-dev:1" }],
          details: { code: 0 },
        }
      }
      if (params.action === "stop") {
        // Only kill the emulator window, not the entire session.
        // Checking if window 1 is the ONLY window — if so, kill session.
        const check = await pi.exec("bash", ["-c", "tmux list-windows -t nordclaw-dev -F '#{window_index}' 2>/dev/null"], { signal })
        const windows = (check.stdout || "").split("\n").filter(Boolean)
        if (windows.length <= 1) {
          // Only emulator window (or none) — safe to kill session
          await pi.exec("bash", ["-c", "tmux kill-session -t nordclaw-dev 2>/dev/null; true"], { signal })
        } else {
          // Other services running (pwa, vm-controller) — only kill window 1
          await pi.exec("bash", ["-c", "tmux kill-window -t nordclaw-dev:1 2>/dev/null; true"], { signal })
        }
        // Also stop any orphaned emulator processes
        await pi.exec("bun", ["firebase", "emulators:stop"], { signal }).catch(() => {})
        return {
          content: [{ type: "text", text: "🛑 Emulator stopped." }],
          details: { code: 0 },
        }
      }
      // status — use ss (portable Linux) instead of lsof (missing on NixOS)
      const result = await pi.exec("ss", [
        "-tlnp",
        "( sport = :4000 or sport = :4400 or sport = :5001 or sport = :8080 or sport = :9099 or sport = :8085 or sport = :9199 or sport = :9150 or sport = :4500 or sport = :9299 or sport = :9499 )",
      ], { signal })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code },
      }
    },
  })
}
