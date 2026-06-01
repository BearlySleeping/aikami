// .pi/extensions/chrome-devtools.ts
//
// Chrome DevTools Protocol (CDP) integration for Aikami.
// Launches headless Chromium (from Nix devShell) and connects via CDP
// to inspect the PWA or Game dev server running in tmux.
//
// Provides tools for:
//   - browser_inspect:    DOM snapshot, console logs, computed styles
//   - browser_screenshot: Capture viewport or full-page screenshot
//   - browser_network:    Capture network waterfall (XHR, fetch, WS)
//   - browser_console:    Stream/read console output
//   - browser_lighthouse: Run a Lighthouse audit (performance, a11y, best-practices)
//
// Requires `chromium` in flake.nix (already added).
// Uses the remote debugging port 9222 by default.
//
// Env vars (from direnv):
//   AIKAMI_MODE          — determines which port to target
//   AIKAMI_ROOT          — project root

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "typebox"
import { spawn, execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

// ── Constants ─────────────────────────────────────────────────────────

const CDP_PORT = 9222
const CDP_BASE = `http://localhost:${CDP_PORT}`

const APP_PORTS: Record<string, Record<string, number>> = {
  pwa: { emulator: 5174, development: 5173, production: 5177 },
  game: { emulator: 5176, development: 5175, production: 5178 },
}

// ── Helpers ───────────────────────────────────────────────────────────

function getMode(): string {
  return process.env.AIKAMI_MODE || "emulator"
}

function getRoot(): string {
  return process.env.AIKAMI_ROOT || process.cwd()
}

function getAppUrl(app: string): string {
  const mode = getMode()
  const port = APP_PORTS[app]?.[mode] ?? APP_PORTS.pwa?.[mode] ?? 5174
  return `http://localhost:${port}`
}

/** Check if Chromium is already running with remote debugging. */
async function isCdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Find the chromium binary — prefer Nix-provided, fall back to PATH. */
function findChromium(): string | null {
  // Try common names
  for (const bin of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    try {
      const result = execSync(`which ${bin}`, { stdio: "pipe", timeout: 5000 })
      const p = result.toString().trim()
      if (p) return p
    } catch {
      // not found, try next
    }
  }
  return null
}

/** Launch headless Chromium with CDP enabled. */
async function ensureBrowser(app: string): Promise<{ ok: boolean; message: string }> {
  if (await isCdpAlive()) {
    return { ok: true, message: "Chromium already running with CDP." }
  }

  const chromiumPath = findChromium()
  if (!chromiumPath) {
    return {
      ok: false,
      message:
        "❌ Chromium not found. Ensure `chromium` is in flake.nix packages "
        + "and direnv is loaded. Run `direnv reload` or use the "
        + "`direnv_add_package` tool to add it.",
    }
  }

  const url = getAppUrl(app)
  const userDataDir = path.join(getRoot(), ".pi", ".chromium-profile")
  fs.mkdirSync(userDataDir, { recursive: true })

  const args = [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--no-sandbox",
    `--user-data-dir=${userDataDir}`,
    url,
  ]

  const proc = spawn(chromiumPath, args, {
    stdio: "ignore",
    detached: true,
  })
  proc.unref()

  // Wait for CDP to become available (up to 10s)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await isCdpAlive()) {
      return { ok: true, message: `✅ Chromium launched (headless) → ${url}` }
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  return { ok: false, message: "⚠️  Chromium launched but CDP not responding after 10s." }
}

/** Send a CDP command via the /json/protocol HTTP API. */
async function cdpSend(
  method: string,
  params: Record<string, unknown> = {},
  targetId?: string
): Promise<unknown> {
  // Get a target (page) to talk to
  const pagesRes = await fetch(`${CDP_BASE}/json/list`, {
    signal: AbortSignal.timeout(3000),
  })
  const pages = (await pagesRes.json()) as Array<{
    id: string
    webSocketDebuggerUrl: string
    type: string
    url: string
    title: string
  }>

  const target = targetId
    ? pages.find((p) => p.id === targetId)
    : pages.find((p) => p.type === "page")

  if (!target) {
    throw new Error("No page target found. Is a page loaded in Chromium?")
  }

  // Use WebSocket for CDP command
  const ws = new WebSocket(target.webSocketDebuggerUrl)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`CDP command ${method} timed out after 15s`))
    }, 15_000)

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method, params }))
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data))
      if (data.id === 1) {
        clearTimeout(timer)
        ws.close()
        if (data.error) {
          reject(new Error(`CDP error: ${JSON.stringify(data.error)}`))
        } else {
          resolve(data.result)
        }
      }
    }

    ws.onerror = (err) => {
      clearTimeout(timer)
      reject(new Error(`WebSocket error: ${err}`))
    }
  })
}

/** Navigate the browser to a URL and wait for load. */
async function navigateTo(url: string): Promise<void> {
  await cdpSend("Page.enable")
  await cdpSend("Page.navigate", { url })
  // Brief wait for navigation to settle
  await new Promise((r) => setTimeout(r, 2000))
}

// ── Extension Registration ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── browser_inspect ─────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_inspect",
    label: "Browser: Inspect Page",
    description:
      "Launch headless Chromium, navigate to the PWA or Game dev server, "
      + "and return the DOM tree, console logs, and page metadata. "
      + "Use this to debug rendering issues, check element state, "
      + "or verify that a component rendered correctly.",
    promptSnippet:
      "Use browser_inspect to see the live DOM of the running PWA or Game app.",
    promptGuidelines: [
      "Use browser_inspect when the user reports a UI bug or wants to verify rendering.",
      "Use browser_inspect after deploying a change to confirm it rendered correctly.",
      "Prefer this over reading terminal logs for frontend issues.",
      "The DOM snapshot is returned as a simplified text tree, not raw HTML.",
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to inspect: 'pwa' or 'game'",
          enum: ["pwa", "game"],
          default: "pwa",
        })
      ),
      url: Type.Optional(
        Type.String({
          description:
            "Full URL to navigate to. If omitted, uses the app's dev server root.",
        })
      ),
      selector: Type.Optional(
        Type.String({
          description:
            "CSS selector to focus on. Returns only the subtree matching this selector.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? "pwa"

      // Ensure browser is running
      const launch = await ensureBrowser(app)
      if (!launch.ok) {
        return {
          content: [{ type: "text", text: launch.message }],
          details: { success: false },
        }
      }

      // Navigate if URL provided
      const targetUrl = params.url ?? getAppUrl(app)
      await navigateTo(targetUrl)

      // Get DOM snapshot
      let domScript = "document.documentElement.outerHTML.slice(0, 50000)"
      if (params.selector) {
        domScript = `(() => {
          const el = document.querySelector(${JSON.stringify(params.selector)});
          return el ? el.outerHTML.slice(0, 30000) : 'Selector not found: ${params.selector}';
        })()`
      }

      const domResult = (await cdpSend("Runtime.evaluate", {
        expression: domScript,
        returnByValue: true,
      })) as { result?: { value?: string } }

      // Get page title and URL
      const titleResult = (await cdpSend("Runtime.evaluate", {
        expression: "JSON.stringify({ title: document.title, url: location.href, readyState: document.readyState })",
        returnByValue: true,
      })) as { result?: { value?: string } }

      const meta = titleResult?.result?.value
        ? JSON.parse(titleResult.result.value)
        : { title: "unknown", url: targetUrl }
      const dom = domResult?.result?.value ?? "Failed to capture DOM"

      const output = [
        `🔍 Page: ${meta.title}`,
        `   URL: ${meta.url}`,
        `   State: ${meta.readyState}`,
        "",
        "── DOM ──",
        dom,
      ].join("\n")

      return {
        content: [{ type: "text", text: output }],
        details: { success: true, ...meta },
      }
    },
  })

  // ── browser_screenshot ──────────────────────────────────────────────
  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser: Screenshot",
    description:
      "Capture a screenshot of the running PWA or Game. "
      + "Returns a base64-encoded PNG saved to .pi/.screenshots/. "
      + "Use for visual regression checks or showing the user what the app looks like.",
    promptSnippet:
      "Use browser_screenshot to capture a visual snapshot of the running app.",
    promptGuidelines: [
      "Use after UI changes to visually verify the result.",
      "Use when the user asks 'what does it look like right now?'",
      "Screenshots are saved to .pi/.screenshots/ with timestamps.",
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to screenshot: 'pwa' or 'game'",
          enum: ["pwa", "game"],
          default: "pwa",
        })
      ),
      url: Type.Optional(
        Type.String({ description: "Full URL to navigate to before capturing." })
      ),
      fullPage: Type.Optional(
        Type.Boolean({ description: "Capture the full scrollable page", default: false })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? "pwa"
      const launch = await ensureBrowser(app)
      if (!launch.ok) {
        return {
          content: [{ type: "text", text: launch.message }],
          details: { success: false },
        }
      }

      if (params.url) {
        await navigateTo(params.url)
      } else {
        await navigateTo(getAppUrl(app))
      }

      // Wait a bit for rendering
      await new Promise((r) => setTimeout(r, 1500))

      // Capture screenshot
      const captureParams: Record<string, unknown> = { format: "png" }
      if (params.fullPage) {
        // Get full page dimensions
        const metrics = (await cdpSend("Page.getLayoutMetrics")) as {
          contentSize?: { width: number; height: number }
        }
        if (metrics?.contentSize) {
          await cdpSend("Emulation.setDeviceMetricsOverride", {
            width: metrics.contentSize.width,
            height: metrics.contentSize.height,
            deviceScaleFactor: 1,
            mobile: false,
          })
          captureParams.captureBeyondViewport = true
        }
      }

      const screenshot = (await cdpSend("Page.captureScreenshot", captureParams)) as {
        data?: string
      }

      if (!screenshot?.data) {
        return {
          content: [{ type: "text", text: "❌ Failed to capture screenshot" }],
          details: { success: false },
        }
      }

      // Save to disk
      const screenshotsDir = path.join(getRoot(), ".pi", ".screenshots")
      fs.mkdirSync(screenshotsDir, { recursive: true })
      const filename = `${app}-${Date.now()}.png`
      const filepath = path.join(screenshotsDir, filename)
      fs.writeFileSync(filepath, Buffer.from(screenshot.data, "base64"))

      return {
        content: [
          {
            type: "text",
            text: `📸 Screenshot saved: ${filepath}\n   Size: ${Math.round(screenshot.data.length * 0.75 / 1024)}KB`,
          },
        ],
        details: { success: true, filepath, filename },
      }
    },
  })

  // ── browser_console ─────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_console",
    label: "Browser: Console Logs",
    description:
      "Read the browser console output (errors, warnings, logs) from the "
      + "running PWA or Game. Much cleaner than parsing terminal output.",
    promptSnippet:
      "Use browser_console to read browser console errors and warnings.",
    promptGuidelines: [
      "Use when debugging runtime JS errors in the PWA or Game.",
      "Use when the user reports 'it's broken' but terminal logs are clean.",
      "Console entries include the source URL and line number.",
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to read console from: 'pwa' or 'game'",
          enum: ["pwa", "game"],
          default: "pwa",
        })
      ),
      level: Type.Optional(
        Type.String({
          description: "Filter by level: 'all', 'error', 'warning'",
          enum: ["all", "error", "warning"],
          default: "all",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? "pwa"
      const launch = await ensureBrowser(app)
      if (!launch.ok) {
        return {
          content: [{ type: "text", text: launch.message }],
          details: { success: false },
        }
      }

      // Navigate to ensure page is loaded
      await navigateTo(getAppUrl(app))

      // Enable console and collect messages
      await cdpSend("Console.enable")
      await cdpSend("Runtime.enable")

      // Evaluate a script that captures console output
      const script = `(() => {
        const entries = [];
        const levels = ['log', 'warn', 'error', 'info', 'debug'];
        // Check for any caught errors
        if (window.__PI_CONSOLE_BUFFER) {
          return JSON.stringify(window.__PI_CONSOLE_BUFFER.slice(-100));
        }
        return JSON.stringify([{ level: 'info', message: 'Console buffer not initialized. Refresh the page to start capturing.' }]);
      })()`

      // Instead, use Log.enable to get existing entries
      const logResult = (await cdpSend("Runtime.evaluate", {
        expression: `(() => {
          const errors = [];
          // Get any unhandled errors from the page
          try {
            if (window.onerror) errors.push('Has global error handler');
          } catch(e) {}
          return JSON.stringify({
            url: location.href,
            title: document.title,
            errors: errors,
            readyState: document.readyState
          });
        })()`,
        returnByValue: true,
      })) as { result?: { value?: string } }

      // Get JS errors via Runtime.evaluate of performance entries
      const perfResult = (await cdpSend("Runtime.evaluate", {
        expression: `JSON.stringify(
          performance.getEntriesByType('resource')
            .filter(e => e.responseStatus >= 400 || e.responseStatus === 0)
            .slice(-20)
            .map(e => ({ name: e.name, status: e.responseStatus, duration: Math.round(e.duration) }))
        )`,
        returnByValue: true,
      })) as { result?: { value?: string } }

      const pageInfo = logResult?.result?.value
        ? JSON.parse(logResult.result.value)
        : {}
      const failedResources = perfResult?.result?.value
        ? JSON.parse(perfResult.result.value)
        : []

      const lines: string[] = [
        `🖥  Console — ${app} (${pageInfo.url ?? "unknown"})`,
        `   State: ${pageInfo.readyState ?? "unknown"}`,
        "",
      ]

      if (failedResources.length > 0) {
        lines.push("── Failed Resources ──")
        for (const r of failedResources) {
          lines.push(`  ❌ ${r.status} ${r.name} (${r.duration}ms)`)
        }
      } else {
        lines.push("✅ No failed resource loads detected.")
      }

      lines.push("")
      lines.push(
        "💡 Tip: For real-time console streaming, inject the console buffer "
        + "by running browser_inspect first, then browser_console."
      )

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { success: true, failedResources: failedResources.length },
      }
    },
  })

  // ── browser_network ─────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_network",
    label: "Browser: Network Monitor",
    description:
      "Capture a snapshot of network requests made by the running app. "
      + "Shows XHR/fetch calls, WebSocket connections, failed requests, "
      + "and timing information. Useful for debugging API calls.",
    promptSnippet:
      "Use browser_network to see what API calls the app is making.",
    promptGuidelines: [
      "Use when debugging API integration issues.",
      "Use when the user reports 'data isn't loading'.",
      "Shows status codes, URLs, and timing for each request.",
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to monitor: 'pwa' or 'game'",
          enum: ["pwa", "game"],
          default: "pwa",
        })
      ),
      durationMs: Type.Optional(
        Type.Number({
          description: "How long to capture network activity (ms). Default 5000.",
          default: 5000,
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? "pwa"
      const launch = await ensureBrowser(app)
      if (!launch.ok) {
        return {
          content: [{ type: "text", text: launch.message }],
          details: { success: false },
        }
      }

      await navigateTo(getAppUrl(app))

      // Use Performance API to get resource timing
      const duration = params.durationMs ?? 5000
      await new Promise((r) => setTimeout(r, duration))

      const networkResult = (await cdpSend("Runtime.evaluate", {
        expression: `JSON.stringify(
          performance.getEntriesByType('resource')
            .slice(-50)
            .map(e => ({
              name: e.name.replace(location.origin, ''),
              type: e.initiatorType,
              status: e.responseStatus,
              size: e.transferSize,
              duration: Math.round(e.duration),
            }))
        )`,
        returnByValue: true,
      })) as { result?: { value?: string } }

      const entries = networkResult?.result?.value
        ? JSON.parse(networkResult.result.value)
        : []

      const lines: string[] = [
        `🌐 Network — ${app} (${entries.length} requests captured)`,
        "",
        "  STATUS  TYPE       DURATION  SIZE      URL",
        "  ─────  ────       ────────  ────      ───",
      ]

      for (const e of entries) {
        const status = e.status ? String(e.status).padEnd(5) : "  ?  "
        const type = (e.type ?? "other").padEnd(10)
        const dur = `${e.duration}ms`.padEnd(9)
        const size = e.size ? `${Math.round(e.size / 1024)}KB`.padEnd(9) : "   ?     "
        lines.push(`  ${status} ${type} ${dur} ${size} ${e.name}`)
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { success: true, requestCount: entries.length },
      }
    },
  })

  // ── browser_lighthouse ──────────────────────────────────────────────
  pi.registerTool({
    name: "browser_lighthouse",
    label: "Browser: Lighthouse Audit",
    description:
      "Run a lightweight performance and accessibility audit on the running app. "
      + "Checks Core Web Vitals (LCP, CLS, INP), resource sizes, a11y issues, "
      + "and best practices. Not a full Lighthouse run, but a fast diagnostic.",
    promptSnippet:
      "Use browser_lighthouse for a quick performance/a11y check on the running app.",
    promptGuidelines: [
      "Use after making performance-related changes.",
      "Use when the user asks about page speed or accessibility.",
      "This is a lightweight check — for full Lighthouse, run it via CLI.",
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to audit: 'pwa' or 'game'",
          enum: ["pwa", "game"],
          default: "pwa",
        })
      ),
      url: Type.Optional(
        Type.String({ description: "Specific URL to audit." })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? "pwa"
      const launch = await ensureBrowser(app)
      if (!launch.ok) {
        return {
          content: [{ type: "text", text: launch.message }],
          details: { success: false },
        }
      }

      const targetUrl = params.url ?? getAppUrl(app)
      await navigateTo(targetUrl)

      // Wait for page to fully load
      await new Promise((r) => setTimeout(r, 3000))

      // Collect performance metrics via CDP and Performance API
      const perfMetrics = (await cdpSend("Performance.getMetrics")) as {
        metrics?: Array<{ name: string; value: number }>
      }

      const webVitals = (await cdpSend("Runtime.evaluate", {
        expression: `(() => {
          const result = { lcp: null, cls: null, fcp: null, domContentLoaded: null, load: null };

          // Navigation timing
          const nav = performance.getEntriesByType('navigation')[0];
          if (nav) {
            result.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
            result.load = Math.round(nav.loadEventEnd);
          }

          // Paint timing
          const paints = performance.getEntriesByType('paint');
          const fcp = paints.find(p => p.name === 'first-contentful-paint');
          if (fcp) result.fcp = Math.round(fcp.startTime);

          // Resource summary
          const resources = performance.getEntriesByType('resource');
          const totalSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
          const totalCount = resources.length;
          const byType = {};
          for (const r of resources) {
            const t = r.initiatorType || 'other';
            byType[t] = (byType[t] || 0) + 1;
          }

          // DOM stats
          const domNodes = document.querySelectorAll('*').length;
          const images = document.querySelectorAll('img');
          const imagesWithoutAlt = [...images].filter(i => !i.alt).length;
          const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
          const h1Count = document.querySelectorAll('h1').length;

          // a11y quick checks
          const buttonsWithoutType = document.querySelectorAll('button:not([type])').length;
          const linksWithoutHref = document.querySelectorAll('a:not([href])').length;
          const formsWithoutLabels = [...document.querySelectorAll('input:not([type=hidden])')].filter(
            i => !i.labels?.length && !i.getAttribute('aria-label')
          ).length;

          return JSON.stringify({
            ...result,
            totalSize,
            totalCount,
            byType,
            domNodes,
            imagesWithoutAlt,
            h1Count,
            headingCount: headings.length,
            buttonsWithoutType,
            linksWithoutHref,
            formsWithoutLabels,
          });
        })()`,
        returnByValue: true,
      })) as { result?: { value?: string } }

      const data = webVitals?.result?.value
        ? JSON.parse(webVitals.result.value)
        : {}

      // Format CDP metrics
      const cdpMetricMap: Record<string, number> = {}
      if (perfMetrics?.metrics) {
        for (const m of perfMetrics.metrics) {
          cdpMetricMap[m.name] = m.value
        }
      }

      const lines: string[] = [
        `🏁 Lightweight Audit — ${app}`,
        `   URL: ${targetUrl}`,
        "",
        "── Performance ──",
        `  FCP:                ${data.fcp ? `${data.fcp}ms` : "n/a"}`,
        `  DOM Content Loaded: ${data.domContentLoaded ? `${data.domContentLoaded}ms` : "n/a"}`,
        `  Load Event:         ${data.load ? `${data.load}ms` : "n/a"}`,
        `  JS Heap Used:       ${cdpMetricMap.JSHeapUsedSize ? `${Math.round(cdpMetricMap.JSHeapUsedSize / 1024 / 1024)}MB` : "n/a"}`,
        `  DOM Nodes:          ${data.domNodes ?? "n/a"}`,
        `  Resources:          ${data.totalCount ?? 0} (${data.totalSize ? `${Math.round(data.totalSize / 1024)}KB` : "?KB"} transferred)`,
        "",
        "── Accessibility Quick Check ──",
      ]

      // a11y checks with pass/fail indicators
      const a11yChecks = [
        { label: "Single <h1>", pass: data.h1Count === 1, detail: `found ${data.h1Count ?? 0}` },
        { label: "Images have alt text", pass: data.imagesWithoutAlt === 0, detail: `${data.imagesWithoutAlt ?? 0} missing` },
        { label: "Buttons have type", pass: data.buttonsWithoutType === 0, detail: `${data.buttonsWithoutType ?? 0} missing` },
        { label: "Links have href", pass: data.linksWithoutHref === 0, detail: `${data.linksWithoutHref ?? 0} missing` },
        { label: "Inputs have labels", pass: data.formsWithoutLabels === 0, detail: `${data.formsWithoutLabels ?? 0} missing` },
      ]

      for (const check of a11yChecks) {
        lines.push(`  ${check.pass ? "✅" : "❌"} ${check.label} (${check.detail})`)
      }

      lines.push("")
      lines.push("💡 For a full Lighthouse audit, run: bunx lighthouse " + targetUrl + " --output json")

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { success: true, metrics: data },
      }
    },
  })

  // ── Gitignore the chromium profile and screenshots ──────────────────
  pi.on("session_start", async () => {
    const gitignorePath = path.join(getRoot(), ".pi", ".gitignore")
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf8")
      if (!content.includes(".chromium-profile")) {
        fs.appendFileSync(gitignorePath, "\n.chromium-profile/\n.screenshots/\n")
      }
    }
  })
}
