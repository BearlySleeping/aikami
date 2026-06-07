// .pi/extensions/tmux-orchestrator.ts
// Manages Aikami dev services in tmux sessions using the shared naming convention:
//   aikami-{mode}
//
// Each service is a tmux window (tab) inside the session.
// Windows are matched by name, not fixed indices.
//
// This is one of three consumers sharing the exact same tmux sessions:
//   1. pi extension (this file)
//   2. test_blackbox
//   3. root package.json scripts (tmux:start, tmux:stop, etc.)
//
// Services survive pi restarts. Pi can read output from any session.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "typebox"
import { EMULATOR_PORTS } from "../../packages/shared/constants/src/lib/development_ports"

type AikamiMode = "emulator" | "staging" | "production"

interface ServiceDef {
  name: string
  /** Canonical key matching package.json scripts */
  key: string
  command: string
  cwd: string
  /** Port getter — computed from mode so PWA uses the right port per environment. */
  getReadyPort: (mode: AikamiMode) => number
  readyPath?: string
}

function makeServices(): Record<string, ServiceDef> {
  return {
    emulator: {
      name: "emulators",
      key: "emulator",
      command: "bun run emulate",
      cwd: "apps/backend/firebase",
      getReadyPort: () => EMULATOR_PORTS.auth,
    },
    pwa: {
      name: "pwa",
      key: "pwa",
      command: "bun run dev",
      cwd: "apps/frontend/pwa",
      getReadyPort: (mode: AikamiMode) => {
        const { PORTS } = require("../../packages/shared/constants/src/lib/development_ports") as any
        return (PORTS as any)[mode]?.pwa ?? EMULATOR_PORTS.pwa
      },
      readyPath: "/",
    },
    // game service consolidated into PWA (C-061)
  }
}

const SERVICES = makeServices()
const ALL_SERVICES = Object.keys(SERVICES)

function getMode(): AikamiMode {
  const env = process.env.AIKAMI_MODE as string | undefined
  if (env === "emulator" || env === "staging" || env === "production") {
    return env
  }
  return "emulator"
}

/** Single session per mode — all services share this session. */
function sessionName(): string {
  return `aikami-${getMode()}`
}

export default function (pi: ExtensionAPI) {
  // ── Tmux helpers ──────────────────────────────────────────────

  async function tmux(args: string[]): Promise<{ code: number; stdout: string }> {
    const r = await pi.exec("tmux", args)
    return { code: r.code, stdout: r.stdout?.trim() ?? "" }
  }

  async function sessionExists(name: string): Promise<boolean> {
    const r = await tmux(["has-session", "-t", name])
    return r.code === 0
  }

  async function getWindowNames(session: string): Promise<string[]> {
    const r = await tmux(["list-windows", "-t", session, "-F", "#{window_name}"])
    return r.stdout.split("\n").filter(Boolean)
  }

  // ── Health check ──────────────────────────────────────────────

  async function isReady(svc: ServiceDef): Promise<boolean> {
    const path = svc.readyPath ?? "/"
    const port = svc.getReadyPort(getMode())
    try {
      const r = await pi.exec("bash", [
        "-c",
        `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}${path} 2>/dev/null || echo '000'`,
      ])
      const code = parseInt(r.stdout?.trim() ?? "0", 10)
      return code >= 200 && code < 500
    } catch {
      return false
    }
  }

  // ── Main Tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: "tmux_session",
    label: "Tmux: Manage Dev Sessions",
    description:
      "Manage Aikami development services (emulator, pwa, game) in persistent tmux sessions. "
      + "Services survive pi restarts and can be inspected via `read` action. "
      + "Sessions use naming convention: aikami-{mode}. "
      + "Each service is a tmux window (tab) in the shared session, matched by name. "
      + "If session already exists with same mode, joins instead of creating.",
    promptSnippet:
      "Use tmux_session to start/stop/inspect Aikami dev services running in tmux.",
    promptGuidelines: [
      "Use tmux_session start <service> to start emulator, pwa, or game.",
      "Use tmux_session read <service> to capture log output from a running service.",
      "Use tmux_session list to see all managed services and their status.",
      "Use tmux_session stop <service> to cleanly stop a service.",
      "Sessions follow naming: aikami-{mode}. Attach: tmux attach -t aikami-emulator",
      "These are the same sessions used by test_blackbox and root package.json tmux scripts.",
    ],
    parameters: Type.Object({
      action: Type.String({
        description: "Action: start, stop, status, read, or list",
        enum: ["start", "stop", "status", "read", "list"],
      }),
      service: Type.Optional(
        Type.String({
          description: `Service name: ${ALL_SERVICES.join(", ")}`,
          enum: ALL_SERVICES,
        })
      ),
      lines: Type.Optional(
        Type.Number({
          description: "Lines to capture (read action only, default 100)",
          default: 100,
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd
      const sess = sessionName()
      const mode = getMode()
      const svc = params.service ? SERVICES[params.service] : undefined

      // ── list ────────────────────────────────────────────────────
      if (params.action === "list") {
        const exists = await sessionExists(sess)
        if (!exists) {
          let out = "**Aikami Dev Services**\n\n"
          for (const s of Object.values(SERVICES)) {
            out += `⏸️ **${s.key}** — not running\n`
          }
          out += "\nNo services running. Start with: tmux_session start <service>"
          return { content: [{ type: "text", text: out }], details: {} }
        }

        const winNames = await getWindowNames(sess)
        const parts: string[] = ["**Aikami Dev Services**\n"]
        let anyRunning = false

        for (const [_name, s] of Object.entries(SERVICES)) {
          const running = winNames.includes(s.name)
          if (!running) {
            parts.push(`⏸️ **${s.key}** — not running`)
            continue
          }
          anyRunning = true
          const ready = await isReady(s)
          const icon = ready ? "✅" : "⏳"
          const port = s.getReadyPort(mode)
          parts.push(`${icon} **${s.key}** (${sess}) — :${port}`)
        }
        if (anyRunning) {
          parts.push(`\nAttach: \`tmux attach -t ${sess}\``)
        } else {
          parts.push("No services running. Start with: tmux_session start <service>")
        }
        return { content: [{ type: "text", text: parts.join("\n") }], details: {} }
      }

      if (!svc) {
        return {
          content: [{ type: "text", text: `Service required for action '${params.action}'. Valid: ${ALL_SERVICES.join(", ")}` }],
          isError: true,
          details: {},
        }
      }

      // ── start ──────────────────────────────────────────────────
      if (params.action === "start") {
        const alreadyExists = await sessionExists(sess)
        const winNames = alreadyExists ? await getWindowNames(sess) : []

        if (winNames.includes(svc.name) && await isReady(svc)) {
          return {
            content: [{ type: "text", text: `✅ ${svc.name} already running (port :${svc.getReadyPort(mode)})\nSession: ${sess}\nAttach: \`tmux attach -t ${sess}\`` }],
            details: { alreadyRunning: true, session: sess },
          }
        }

        _onUpdate?.({ content: [{ type: "text", text: `Starting ${svc.name} in ${sess}...` }] })

        if (winNames.includes(svc.name)) {
          await tmux(["kill-window", "-t", `${sess}:=${svc.name}`])
          await new Promise((r) => setTimeout(r, 500))
        }

        const svcCwd = `${cwd}/${svc.cwd}`

        if (!alreadyExists) {
          await pi.exec("tmux", [
            "new-session", "-d", "-s", sess,
            "-c", svcCwd, "-n", svc.name,
            "-e", `AIKAMI_TMUX_MODE=${mode}`,
            svc.command,
          ])
        } else {
          await pi.exec("tmux", [
            "new-window", "-d", "-t", sess,
            "-n", svc.name, "-c", svcCwd,
            svc.command,
          ])
        }

        let ready = false
        for (let i = 0; i < 30 && !ready; i++) {
          if (signal.aborted) break
          await new Promise((r) => setTimeout(r, 2000))
          ready = await isReady(svc)
        }

        if (!ready) {
          return {
            content: [{ type: "text", text: `⚠️ ${svc.name} started but not responding on port :${svc.getReadyPort(mode)} after 60s.\nCheck: \`tmux attach -t ${sess}\`` }],
            isError: true,
            details: { timedOut: true, session: sess },
          }
        }

        return {
          content: [{ type: "text", text: `✅ ${svc.name} running (port :${svc.getReadyPort(mode)})\nSession: ${sess}\nAttach: \`tmux attach -t ${sess}\`` }],
          details: { session: sess },
        }
      }

      // ── stop ──────────────────────────────────────────────────
      if (params.action === "stop") {
        if (!(await sessionExists(sess))) {
          return {
            content: [{ type: "text", text: `Session ${sess} is not running.` }],
            details: {},
          }
        }

        const winNames = await getWindowNames(sess)
        if (!winNames.includes(svc.name)) {
          return {
            content: [{ type: "text", text: `⏸️ ${svc.name} is not running in ${sess}.` }],
            details: {},
          }
        }

        if (winNames.length === 1) {
          await tmux(["kill-session", "-t", sess])
        } else {
          await tmux(["kill-window", "-t", `${sess}:=${svc.name}`])
        }

        return {
          content: [{ type: "text", text: `🛑 Stopped ${svc.name} in ${sess}.` }],
          details: {},
        }
      }

      // ── status ────────────────────────────────────────────────
      if (params.action === "status") {
        if (!(await sessionExists(sess))) {
          return {
            content: [{ type: "text", text: `⏸️ ${svc.name} — not running\nSession would be: ${sess}` }],
            details: { running: false },
          }
        }

        const winNames = await getWindowNames(sess)
        if (!winNames.includes(svc.name)) {
          return {
            content: [{ type: "text", text: `⏸️ ${svc.name} — not running in ${sess}` }],
            details: { running: false },
          }
        }

        const ready = await isReady(svc)
        const icon = ready ? "✅" : "❌"
        return {
          content: [{ type: "text", text: `${icon} ${svc.name} — port :${svc.getReadyPort(mode)} ${ready ? "responding" : "NOT responding"}\nSession: ${sess}\nAttach: \`tmux attach -t ${sess}\`` }],
          details: { running: ready, session: sess },
        }
      }

      // ── read ──────────────────────────────────────────────────
      if (params.action === "read") {
        if (!(await sessionExists(sess))) {
          return {
            content: [{ type: "text", text: `Session ${sess} is not running.` }],
            details: {},
          }
        }

        const lines = params.lines ?? 100
        const result = await pi.exec("tmux", [
          "capture-pane", "-p", "-t", `${sess}:=${svc.name}`, "-S", `-${lines}`, "-J",
        ], { signal })

        const output = result.stdout?.trim()
        if (!output) {
          return {
            content: [{ type: "text", text: `No output in ${svc.name}. Service may not have started yet.\nCheck: \`tmux attach -t ${sess}\`` }],
            details: {},
          }
        }

        return {
          content: [{ type: "text", text: `**${svc.name}** (last ${lines} lines):\n\n\`\`\`\n${output}\n\`\`\`` }],
          details: {},
        }
      }

      return {
        content: [{ type: "text", text: `Unknown action: ${params.action}` }],
        isError: true,
        details: {},
      }
    },
  })
}
