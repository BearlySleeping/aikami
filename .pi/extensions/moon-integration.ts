// .pi/extensions/moon-integration.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "typebox"

/** Fallback workspace summary — used if moon query fails. Update when projects change. */
const FALLBACK_SUMMARY = `Workspace: aikami projects (moon)
Apps:  pwa, landing-page, docs, game, firebase
Libs:  constants, schemas, types, logger, utils, mocks, backend-*, frontend-*`

export default function (pi: ExtensionAPI) {
  let workspaceSummary = FALLBACK_SUMMARY

  // ── Fetch workspace dynamically on session start ─────────────────────
  pi.on("session_start", async (_event, _ctx) => {
    try {
      const result = await pi.exec("bun", ["moon", "query", "projects", "--json"])
      if (result.code === 0 && result.stdout) {
        const data = JSON.parse(result.stdout)
        const projects = data.projects ?? []
        const apps = projects.filter((p: any) => p.tags?.includes("application") ?? false)
        const libs = projects.filter((p: any) => !p.tags?.includes("application"))
        const appNames = apps.map((p: any) => p.id).join(", ")
        const libNames = libs.map((p: any) => p.id).join(", ")
        workspaceSummary = `Workspace: ${projects.length} projects (moon)\nApps:  ${appNames}\nLibs:  ${libNames}`
      }
    } catch {
      // Keep fallback
    }
  })

  // ── Detect Affected Projects ───────────────────────────────────────────
  pi.registerTool({
    name: "moon_detect_affected",
    label: "Moon: Detect Affected",
    description:
      "Detects affected projects via moon query --affected. Run BEFORE validation to know which projects changed.",
    promptSnippet:
      "Use moon_detect_affected before running tests or deploying to discover which projects changed.",
    promptGuidelines: [
      "Use moon_detect_affected when you need to know which packages changed before running tests or deploying.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      const result = await pi.exec("bun", [
        "moon",
        "query",
        "projects",
        "--affected",
      ], { signal })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code },
      }
    },
  })

  // ── Run Moon Task ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "moon_run_task",
    label: "Moon: Run Task",
    description:
      "Run a single moon task: fix, typecheck, build, test, dev, deploy, logs, etc. Format: <project>:<task> (e.g. pwa:fix, functions:typecheck).",
    promptSnippet:
      "Use moon_run_task to execute moon tasks like build, test, lint, or dev servers.",
    promptGuidelines: [
      "Use moon_run_task to run monorepo tasks through the moon orchestrator instead of calling bun directly.",
    ],
    parameters: Type.Object({
      target: Type.String({
        description:
          "Moon task target, e.g. 'pwa:dev', 'functions:typecheck', 'schemas:build'",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const result = await pi.exec("bun", [
        "moon",
        "run",
        params.target,
      ], { signal })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code },
      }
    },
  })

  // ── List Projects ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "moon_list_projects",
    label: "Moon: List Projects",
    description:
      "List all monorepo projects registered in moon with tags and deps.",
    promptSnippet:
      "Use moon_list_projects to understand the monorepo workspace structure.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      const result = await pi.exec("bun", [
        "moon",
        "query",
        "projects",
      ], { signal })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code },
      }
    },
  })

  // ── Batch Validate ────────────────────────────────────────────────────
  pi.registerTool({
    name: "validate",
    label: "Batch Validate",
    description:
      "Validate changed projects: detect affected → run fix+typecheck → optionally build+test. "
      + "Use at END of feature, not during development. No test-runner string — moon handles caching.",
    promptSnippet:
      "Use validate at the end of a feature to run fix+typecheck+build+test on all affected projects.",
    promptGuidelines: [
      "Call validate at the end of a development task — not during writing code.",
      "validate runs fix+typecheck on all affected projects (moon caches unchanged projects).",
      "If fix+typecheck pass, optionally run build then test.",
      "Pass test=true to also run unit/E2E tests after build passes.",
      "The direnv environment (AIKAMI_MODE) is already loaded — no need to check mode.",
    ],
    parameters: Type.Object({
      test: Type.Optional(Type.Boolean({
        description:
          "If true, also run build + tests after fix+typecheck pass.",
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const errors: string[] = []
      const ok: string[] = []

      // 1. Detect affected
      const affectedResult = await pi.exec("bun", [
        "moon",
        "query",
        "projects",
        "--affected",
      ], { signal })
      let affectedProjects: string[] = []
      try {
        const parsed = JSON.parse(affectedResult.stdout || "{}")
        affectedProjects = parsed.projects?.map((p: { id: string }) => p.id) || []
      } catch {
        affectedProjects = (affectedResult.stdout || "").split("\n").filter(Boolean)
      }

      if (affectedProjects.length === 0) {
        return {
          content: [{ type: "text", text: "No affected projects. Nothing to validate." }],
          details: { code: 0 },
        }
      }

      const projList = affectedProjects.join(", ")
      // 2. Run fix + typecheck via workspace-level --affected (moon handles parallelism)
      const fixResult = await pi.exec("bun", ["moon", "run", ":fix", "--affected"], { signal })
      if (fixResult.code !== 0) {
        errors.push(":fix failed (see output for details)")
      } else {
        ok.push(":fix")
      }

      const tcResult = await pi.exec("bun", ["moon", "run", ":typecheck", "--affected"], { signal })
      if (tcResult.code !== 0) {
        errors.push(":typecheck failed (see output for details)")
      } else {
        ok.push(":typecheck")
      }

      // 3. Build + test (optional, only if fix+typecheck passed)
      if (params.test && errors.length === 0) {
        const buildResult = await pi.exec("bun", ["moon", "run", ":build", "--affected"], { signal })
        if (buildResult.code !== 0) {
          errors.push(":build failed (see output for details)")
        } else {
          ok.push(":build")
        }

        const testResult = await pi.exec("bun", ["moon", "run", ":test", "--affected"], { signal })
        if (testResult.code !== 0) {
          errors.push(":test failed (see output for details)")
        } else {
          ok.push(":test")
        }
      }

      // 4. Report
      let report = `Projects: ${projList}\n\n`
      report += `✅ ${ok.length} passed\n`
      if (errors.length > 0) {
        report += `❌ ${errors.length} failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`
      }

      return {
        content: [{ type: "text", text: report }],
        details: { code: errors.length > 0 ? 1 : 0 },
      }
    },
  })

  // ── Blackbox Test Runner ───────────────────────────────────────────
  pi.registerTool({
    name: "blackbox_test",
    label: "Test: Blackbox",
    description:
      "Runs blackbox integration tests against local emulators + dev servers. "
      + "Starts/stops emulators and dev servers automatically. "
      + "Suites: schema-check, functions, pwa, landing-page, docs, cross-service.",
    promptSnippet:
      "Use blackbox_test to run full-stack blackbox integration tests locally.",
    promptGuidelines: [
      "Use blackbox_test after making backend changes that affect multiple services.",
      "Use blackbox_test suites=['functions'] to run only function tests (faster).",
      "Ensure emulator is running first: firebase_emulator start.",
      "Blackbox tests start/stop their own dev servers — no need to pre-start.",
      "Use noCrossService=true to skip multi-service flow tests during rapid iteration.",
      "Current mode from direnv: emulator=local, development/production=live GCP. Blackbox tests require emulator mode.",
    ],
    parameters: Type.Object({
      suites: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Specific suites to run: schema-check, functions, pwa, landing-page, docs, cross-service. Omit to run all.",
          default: [],
        })
      ),
      noCrossService: Type.Optional(
        Type.Boolean({
          description: "Skip cross-service tests (faster iteration)",
          default: false,
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const args = ["run", "test:blackbox"]
      if (params.suites && params.suites.length > 0) args.push(...params.suites)
      if (params.noCrossService) args.push("--no-cross-service")

      _onUpdate?.({ content: [{ type: "text", text: `Running blackbox tests (${params.suites?.join(", ") || "all"})...` }] })

      const result = await pi.exec("bun", args, { signal, timeout: 300000 }) // 5 min timeout

      // Try to parse JSON report for structured output
      let parsedReport: any = null
      try {
        const jsonMatch = (result.stdout || "").match(/\{[\s\S]*"suites"[\s\S]*\}/)
        if (jsonMatch) parsedReport = JSON.parse(jsonMatch[0])
      } catch { /* use raw output */ }

      if (parsedReport) {
        const lines = [
          `**Blackbox Results** (${parsedReport.duration}ms)`,
          `Passed: ${parsedReport.passed} | Failed: ${parsedReport.failed} | Skipped: ${parsedReport.skipped}`,
          "",
        ]
        for (const s of parsedReport.suites) {
          const icon = s.status === "pass" ? "✅" : s.status === "fail" ? "❌" : "⏭️"
          lines.push(`${icon} **${s.name}** (${s.duration}ms)`)
          if (s.error) lines.push(`   Error: ${s.error.slice(0, 200)}`)
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { code: result.code, ...parsedReport },
        }
      }

      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { code: result.code },
      }
    },
  })

  // ── Lightweight workspace context (dynamically fetched) ────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    const modeInfo = process.env.AIKAMI_MODE
      ? `\nDirenv: AIKAMI_MODE=${process.env.AIKAMI_MODE}  project=${process.env.AIKAMI_PROJECT_ID || "?"}`
      : ""
    return {
      systemPrompt: `${event.systemPrompt}\n\n${workspaceSummary}${modeInfo}`,
    }
  })
}
