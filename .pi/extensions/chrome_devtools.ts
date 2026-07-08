// .pi/extensions/chrome_devtools.ts
//
// Chrome DevTools Protocol (CDP) integration for Aikami.
// Launches headless Chromium (from Nix devShell) and connects via CDP
// to inspect the Client dev server running in tmux.
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

import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { PORTS } from '../../packages/shared/constants/src/lib/development_ports';
import { optimizeImage } from '../../scripts/src/lib/ai/image_optimizer';

// ── Constants ─────────────────────────────────────────────────────────

const CDP_PORT = 9222;
const CDP_BASE = `http://localhost:${CDP_PORT}`;

// ── Helpers ───────────────────────────────────────────────────────────

function getMode(): string {
  return process.env.AIKAMI_MODE || 'emulator';
}

function getRoot(): string {
  return process.env.AIKAMI_ROOT || process.cwd();
}

function getAppUrl(app: string): string {
  const mode = getMode();
  const modePorts = PORTS[mode as keyof typeof PORTS];
  if (modePorts && app in modePorts) {
    const port = (modePorts as Record<string, number>)[app];
    return `http://localhost:${port}`;
  }
  // Fallback: use emulator client
  return `http://localhost:${PORTS.emulator.client}`;
}

/** Check if Chromium is already running with remote debugging. */
async function isCdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Find the chromium binary — prefer Nix-provided, fall back to PATH. */
function findChromium(): string | null {
  // Try common names
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    try {
      const result = execSync(`which ${bin}`, { stdio: 'pipe', timeout: 5000 });
      const p = result.toString().trim();
      if (p) {
        return p;
      }
    } catch {
      // not found, try next
    }
  }
  return null;
}

/** Launch headless Chromium with CDP enabled. */
async function ensureBrowser(_app: string): Promise<{ ok: boolean; message: string }> {
  if (await isCdpAlive()) {
    return { ok: true, message: 'Chromium already running with CDP.' };
  }

  const chromiumPath = findChromium();
  if (!chromiumPath) {
    return {
      ok: false,
      message:
        '❌ Chromium not found. Ensure `chromium` is in flake.nix packages ' +
        'and direnv is loaded. Run `direnv reload` or use the ' +
        '`direnv_add_package` tool to add it.',
    };
  }

  const userDataDir = path.join(getRoot(), '.pi', '.chromium-profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];

  const proc = spawn(chromiumPath, args, {
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();

  // Wait for CDP to become available (up to 10s)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isCdpAlive()) {
      return { ok: true, message: `✅ Chromium launched (headless) with CDP on port ${CDP_PORT}` };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return { ok: false, message: '⚠️  Chromium launched but CDP not responding after 10s.' };
}

/** Send a CDP command via the /json/protocol HTTP API. */
async function cdpSend(
  method: string,
  params: Record<string, unknown> = {},
  targetId?: string,
): Promise<unknown> {
  // Get a target (page) to talk to
  const pagesRes = await fetch(`${CDP_BASE}/json/list`, {
    signal: AbortSignal.timeout(3000),
  });
  const pages = (await pagesRes.json()) as Array<{
    id: string;
    webSocketDebuggerUrl: string;
    type: string;
    url: string;
    title: string;
  }>;

  const target = targetId
    ? pages.find((p) => p.id === targetId)
    : pages.find((p) => p.type === 'page');

  if (!target) {
    throw new Error('No page target found. Is a page loaded in Chromium?');
  }

  // Use WebSocket for CDP command
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP command ${method} timed out after 15s`));
    }, 15_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data));
      if (data.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (data.error) {
          reject(new Error(`CDP error: ${JSON.stringify(data.error)}`));
        } else {
          resolve(data.result);
        }
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err}`));
    };
  });
}

/** Navigate the browser to a URL and wait for load. */
async function navigateTo(url: string): Promise<void> {
  await cdpSend('Page.enable');
  await cdpSend('Page.navigate', { url });
  // Brief wait for navigation to settle
  await new Promise((r) => setTimeout(r, 2000));
}

// ── Extension Registration ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── browser_inspect ─────────────────────────────────────────────────
  pi.registerTool({
    name: 'browser_inspect',
    label: 'Browser: Inspect Page',
    description:
      'Launch headless Chromium, navigate to the Client dev server, ' +
      'and return the DOM tree, console logs, and page metadata. ' +
      'Use this to debug rendering issues, check element state, ' +
      'or verify that a component rendered correctly.',
    promptSnippet: 'Use browser_inspect to see the live DOM of the running Client app.',
    promptGuidelines: [
      'Use browser_inspect when the user reports a UI bug, blank page, or unexpected rendering.',
      'Use ONCE — do not repeatedly inspect the same page without navigating or triggering new state.',
      'Prefer reading source code and tmux logs before resorting to browser_inspect.',
      'Use the `selector` parameter to narrow output — full DOM dumps are wasteful.',
      'The DOM snapshot is a simplified text tree, not raw HTML.',
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to inspect: 'client'",
          enum: ['client'],
          default: 'client',
        }),
      ),
      url: Type.Optional(
        Type.String({
          description: "Full URL to navigate to. If omitted, uses the app's dev server root.",
        }),
      ),
      selector: Type.Optional(
        Type.String({
          description: 'CSS selector to focus on. Returns only the subtree matching this selector.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? 'client';

      // Ensure browser is running
      const launch = await ensureBrowser(app);
      if (!launch.ok) {
        return {
          content: [{ type: 'text', text: launch.message }],
          details: { success: false },
        };
      }

      // Navigate if URL provided
      const targetUrl = params.url ?? getAppUrl(app);
      await navigateTo(targetUrl);

      // Get DOM snapshot
      let domScript = 'document.documentElement.outerHTML.slice(0, 50000)';
      if (params.selector) {
        domScript = `(() => {
          const el = document.querySelector(${JSON.stringify(params.selector)});
          return el ? el.outerHTML.slice(0, 30000) : 'Selector not found: ${params.selector}';
        })()`;
      }

      const domResult = (await cdpSend('Runtime.evaluate', {
        expression: domScript,
        returnByValue: true,
      })) as { result?: { value?: string } };

      // Get page title and URL
      const titleResult = (await cdpSend('Runtime.evaluate', {
        expression:
          'JSON.stringify({ title: document.title, url: location.href, readyState: document.readyState })',
        returnByValue: true,
      })) as { result?: { value?: string } };

      const meta = titleResult?.result?.value
        ? JSON.parse(titleResult.result.value)
        : { title: 'unknown', url: targetUrl };
      const dom = domResult?.result?.value ?? 'Failed to capture DOM';

      const output = [
        `🔍 Page: ${meta.title}`,
        `   URL: ${meta.url}`,
        `   State: ${meta.readyState}`,
        '',
        '── DOM ──',
        dom,
      ].join('\n');

      return {
        content: [{ type: 'text', text: output }],
        details: { success: true, ...meta },
      };
    },
  });

  // ── browser_screenshot ──────────────────────────────────────────────
  pi.registerTool({
    name: 'browser_screenshot',
    label: 'Browser: Screenshot',
    description:
      'Capture a screenshot of the running Client. ' +
      'Returns a base64-encoded PNG saved to .pi/.screenshots/. ' +
      'Use for visual regression checks or showing the user what the app looks like.',
    promptSnippet: 'Use browser_screenshot to capture a visual snapshot of the running app.',
    promptGuidelines: [
      'ONLY use when the user explicitly asks to see the page, or for final verification after a fix.',
      'Do NOT screenshot repeatedly during debugging — one is enough.',
      'Screenshots are saved to .pi/.screenshots/ with timestamps.',
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to screenshot: 'client'",
          enum: ['client'],
          default: 'client',
        }),
      ),
      url: Type.Optional(Type.String({ description: 'Full URL to navigate to before capturing.' })),
      fullPage: Type.Optional(
        Type.Boolean({ description: 'Capture the full scrollable page', default: false }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? 'client';
      const launch = await ensureBrowser(app);
      if (!launch.ok) {
        return {
          content: [{ type: 'text', text: launch.message }],
          details: { success: false },
        };
      }

      if (params.url) {
        await navigateTo(params.url);
      } else {
        await navigateTo(getAppUrl(app));
      }

      // Wait a bit for rendering
      await new Promise((r) => setTimeout(r, 1500));

      // Capture screenshot
      const captureParams: Record<string, unknown> = { format: 'png' };
      if (params.fullPage) {
        // Get full page dimensions
        const metrics = (await cdpSend('Page.getLayoutMetrics')) as {
          contentSize?: { width: number; height: number };
        };
        if (metrics?.contentSize) {
          await cdpSend('Emulation.setDeviceMetricsOverride', {
            width: metrics.contentSize.width,
            height: metrics.contentSize.height,
            deviceScaleFactor: 1,
            mobile: false,
          });
          captureParams.captureBeyondViewport = true;
        }
      }

      const screenshot = (await cdpSend('Page.captureScreenshot', captureParams)) as {
        data?: string;
      };

      if (!screenshot?.data) {
        return {
          content: [{ type: 'text', text: '❌ Failed to capture screenshot' }],
          details: { success: false },
        };
      }

      // Save to disk
      const screenshotsDir = path.join(getRoot(), '.pi', '.screenshots');
      fs.mkdirSync(screenshotsDir, { recursive: true });
      const filename = `${app}-${Date.now()}.png`;
      const filepath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filepath, Buffer.from(screenshot.data, 'base64'));

      // Optimise the screenshot for AI consumption (shared pipeline)
      await optimizeImage({ filepath });

      return {
        content: [
          {
            type: 'text',
            text: `📸 Screenshot saved: ${filepath}\n   Size: ${Math.round((screenshot.data.length * 0.75) / 1024)}KB`,
          },
        ],
        details: { success: true, filepath, filename },
      };
    },
  });

  // ── browser_console ─────────────────────────────────────────────────
  pi.registerTool({
    name: 'browser_console',
    label: 'Browser: Console Logs',
    description:
      'Read the browser console output (errors, warnings, logs) from the ' +
      'running Client. Intercepts console.* calls and uncaught errors ' +
      'to surface what the app is actually logging. Prefer this over terminal ' +
      'logs only when you have a specific reason to believe JS errors are ' +
      'occurring in the browser.',
    promptSnippet: 'Use browser_console to read browser console errors and warnings.',
    promptGuidelines: [
      'ONLY use when you have evidence of a browser-side JS error (e.g., blank page, broken UI).',
      'Do NOT call preemptively — use code inspection + tmux logs first.',
      'A single call is sufficient; repeated calls yield the same buffer.',
      'Console entries show source URL and line number for stack traces.',
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to read console from: 'client'",
          enum: ['client'],
          default: 'client',
        }),
      ),
      level: Type.Optional(
        Type.String({
          description: "Filter by level: 'all', 'error', 'warning'",
          enum: ['all', 'error', 'warning'],
          default: 'all',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? 'client';
      const level = params.level ?? 'all';
      const launch = await ensureBrowser(app);
      if (!launch.ok) {
        return {
          content: [{ type: 'text', text: launch.message }],
          details: { success: false },
        };
      }

      // Instead of monkey-patching console.* (which has timing issues),
      // use CDP's native Runtime.consoleAPICalled event to capture
      // all console output from page load onward.
      const targetUrl = getAppUrl(app);

      const pagesRes = await fetch(`${CDP_BASE}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      const pages = (await pagesRes.json()) as Array<{
        id: string;
        webSocketDebuggerUrl: string;
        type: string;
      }>;
      const target = pages.find((p) => p.type === 'page');
      if (!target) {
        return {
          content: [{ type: 'text', text: '❌ No page target found in Chromium.' }],
          details: { success: false },
        };
      }

      // Collect console entries via CDP events over a persistent WebSocket.
      const entries: Array<{
        level: string;
        args: string[];
        ts: number;
        stack: string;
      }> = [];

      let pageUrl = 'unknown';
      let readyState = 'unknown';
      let loadComplete = false;

      const ws = new WebSocket(target.webSocketDebuggerUrl);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(); // Timeout — return whatever we collected
        }, 8000);

        ws.onopen = () => {
          // Enable Runtime domain to receive console events
          ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(String(event.data));

          // Handle console API calls
          if (msg.method === 'Runtime.consoleAPICalled') {
            const entry = msg.params as {
              type: string;
              args: Array<{ value?: string; description?: string }>;
              timestamp: number;
              stackTrace?: {
                callFrames: Array<{ functionName: string; url: string; lineNumber: number }>;
              };
            };
            const entryLevel = entry.type;
            const args: string[] = entry.args.map((a: { value?: string }) => {
              try {
                return typeof a.value === 'object'
                  ? JSON.stringify(a.value).slice(0, 500)
                  : String(a.value ?? '').slice(0, 500);
              } catch {
                return '[unserializable]';
              }
            });
            const stack =
              entry.stackTrace?.callFrames
                ?.map(
                  (f: { functionName: string; url: string; lineNumber: number }) =>
                    `    at ${f.functionName || '(anonymous)'} (${f.url}:${f.lineNumber})`,
                )
                .join('\n') ?? '';
            entries.push({
              level: entryLevel,
              args,
              ts: entry.timestamp,
              stack,
            });
          }

          // Handle exceptions
          if (msg.method === 'Runtime.exceptionThrown') {
            const details = msg.params.exceptionDetails as {
              text?: string;
              url?: string;
              lineNumber?: number;
              stackTrace?: {
                callFrames: Array<{ functionName: string; url: string; lineNumber: number }>;
              };
            };
            entries.push({
              level: 'error',
              args: [
                details.text ?? 'Uncaught exception',
                `at ${details.url ?? ''}:${details.lineNumber ?? '?'}`,
              ],
              ts: msg.params.timestamp,
              stack:
                details.stackTrace?.callFrames
                  ?.map(
                    (f: { functionName: string; url: string; lineNumber: number }) =>
                      `    at ${f.functionName || '(anonymous)'} (${f.url}:${f.lineNumber})`,
                  )
                  .join('\n') ?? '',
            });
          }

          // Handle command responses
          if (msg.id === 1) {
            // Runtime.enable done — now enable Page domain and navigate
            ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
          }
          if (msg.id === 2) {
            ws.send(
              JSON.stringify({
                id: 3,
                method: 'Page.navigate',
                params: { url: targetUrl },
              }),
            );
          }
          if (msg.id === 3) {
            // Navigation started. Wait for load event, then collect.
          }

          // Detect page load complete
          if (msg.method === 'Page.loadEventFired') {
            loadComplete = true;
            // Give the page a moment to settle, then resolve
            setTimeout(() => {
              clearTimeout(timer);
              resolve();
            }, 2000);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(new Error(`WebSocket error: ${err}`));
        };
      });

      ws.close();

      // Fetch page metadata
      if (entries.length > 0) {
        try {
          const metaResult = (await cdpSend('Runtime.evaluate', {
            expression:
              'JSON.stringify({ title: document.title, url: location.href, readyState: document.readyState })',
            returnByValue: true,
          })) as { result?: { value?: string } };
          const meta = metaResult?.result?.value
            ? JSON.parse(metaResult.result.value)
            : { title: 'unknown', url: targetUrl, readyState: 'unknown' };
          pageUrl = meta.url;
          readyState = meta.readyState;
        } catch {
          // Use defaults
        }
      } else {
        pageUrl = targetUrl;
      }

      const levelFilter = params.level ?? 'all';
      const filtered =
        levelFilter === 'all'
          ? entries
          : levelFilter === 'warning'
            ? entries.filter((e) => e.level === 'warn' || e.level === 'error')
            : entries.filter((e) => e.level === levelFilter);

      const lines: string[] = [
        `🖥  Console — ${app} (${pageUrl})`,
        `   State: ${readyState}${loadComplete ? ' (load complete)' : ' (capturing...)'}`,
        `   Buffered: ${filtered.length} entries shown${entries.length !== filtered.length ? ` (${entries.length} total, filtered by level: ${level})` : ''}`,
        `   Interceptor: ✅ CDP native event capture`,
        '',
      ];

      if (filtered.length === 0) {
        lines.push('No console output captured.');
        if (entries.length === 0) {
          lines.push('');
          lines.push(
            '💡 The page may not have generated console output, or it loaded too quickly.',
          );
          lines.push('   Try triggering an action on the page and check again.');
        }
      } else {
        lines.push('── Console Entries (newest last) ──');
        for (const entry of filtered.slice(-50)) {
          const icon = entry.level === 'error' ? '❌' : entry.level === 'warn' ? '⚠️ ' : '📋';
          const time = new Date(entry.ts).toISOString().slice(11, 23);
          lines.push(`  ${icon} [${time}] ${entry.level}: ${entry.args.join(' ')}`);
          if (entry.stack && (entry.level === 'error' || entry.level === 'warn')) {
            for (const frame of entry.stack.split('\n').slice(0, 3)) {
              lines.push(`       ${frame.trim()}`);
            }
          }
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {
          success: true,
          total: entries.length,
          filtered: filtered.length,
        },
      };
    },
  });

  // ── browser_network ─────────────────────────────────────────────────
  pi.registerTool({
    name: 'browser_network',
    label: 'Browser: Network Monitor',
    description:
      'Capture a snapshot of network requests made by the running app. ' +
      'Shows XHR/fetch calls, WebSocket connections, failed requests, ' +
      'and timing information. Useful for debugging API calls.',
    promptSnippet: 'Use browser_network to see what API calls the app is making.',
    promptGuidelines: [
      'ONLY use when you have a specific hypothesis about a failing API call.',
      'Do NOT call preemptively — inspect code and tmux logs first.',
      'A single capture is sufficient; increase durationMs if needed.',
      'Shows status codes, URLs, and timing for each request.',
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to monitor: 'client'",
          enum: ['client'],
          default: 'client',
        }),
      ),
      durationMs: Type.Optional(
        Type.Number({
          description: 'How long to capture network activity (ms). Default 5000.',
          default: 5000,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? 'client';
      const launch = await ensureBrowser(app);
      if (!launch.ok) {
        return {
          content: [{ type: 'text', text: launch.message }],
          details: { success: false },
        };
      }

      await navigateTo(getAppUrl(app));

      // Use Performance API to get resource timing
      const duration = params.durationMs ?? 5000;
      await new Promise((r) => setTimeout(r, duration));

      const networkResult = (await cdpSend('Runtime.evaluate', {
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
      })) as { result?: { value?: string } };

      const entries = networkResult?.result?.value ? JSON.parse(networkResult.result.value) : [];

      const lines: string[] = [
        `🌐 Network — ${app} (${entries.length} requests captured)`,
        '',
        '  STATUS  TYPE       DURATION  SIZE      URL',
        '  ─────  ────       ────────  ────      ───',
      ];

      for (const e of entries) {
        const status = e.status ? String(e.status).padEnd(5) : '  ?  ';
        const type = (e.type ?? 'other').padEnd(10);
        const dur = `${e.duration}ms`.padEnd(9);
        const size = e.size ? `${Math.round(e.size / 1024)}KB`.padEnd(9) : '   ?     ';
        lines.push(`  ${status} ${type} ${dur} ${size} ${e.name}`);
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { success: true, requestCount: entries.length },
      };
    },
  });

  // ── browser_lighthouse ──────────────────────────────────────────────
  pi.registerTool({
    name: 'browser_lighthouse',
    label: 'Browser: Lighthouse Audit',
    description:
      'Run a lightweight performance and accessibility audit on the running app. ' +
      'Checks Core Web Vitals (LCP, CLS, INP), resource sizes, a11y issues, ' +
      'and best practices. Not a full Lighthouse run, but a fast diagnostic.',
    promptSnippet: 'Use browser_lighthouse for a quick performance/a11y check on the running app.',
    promptGuidelines: [
      'ONLY use when the user specifically asks about performance or accessibility.',
      'Do NOT use during general debugging — this is a specialized audit tool.',
      'This is a lightweight check — for full Lighthouse, run via CLI.',
    ],
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App to audit: 'client'",
          enum: ['client'],
          default: 'client',
        }),
      ),
      url: Type.Optional(Type.String({ description: 'Specific URL to audit.' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const app = params.app ?? 'client';
      const launch = await ensureBrowser(app);
      if (!launch.ok) {
        return {
          content: [{ type: 'text', text: launch.message }],
          details: { success: false },
        };
      }

      const targetUrl = params.url ?? getAppUrl(app);
      await navigateTo(targetUrl);

      // Wait for page to fully load
      await new Promise((r) => setTimeout(r, 3000));

      // Collect performance metrics via CDP and Performance API
      const perfMetrics = (await cdpSend('Performance.getMetrics')) as {
        metrics?: Array<{ name: string; value: number }>;
      };

      const webVitals = (await cdpSend('Runtime.evaluate', {
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
      })) as { result?: { value?: string } };

      const data = webVitals?.result?.value ? JSON.parse(webVitals.result.value) : {};

      // Format CDP metrics
      const cdpMetricMap: Record<string, number> = {};
      if (perfMetrics?.metrics) {
        for (const m of perfMetrics.metrics) {
          cdpMetricMap[m.name] = m.value;
        }
      }

      const lines: string[] = [
        `🏁 Lightweight Audit — ${app}`,
        `   URL: ${targetUrl}`,
        '',
        '── Performance ──',
        `  FCP:                ${data.fcp ? `${data.fcp}ms` : 'n/a'}`,
        `  DOM Content Loaded: ${data.domContentLoaded ? `${data.domContentLoaded}ms` : 'n/a'}`,
        `  Load Event:         ${data.load ? `${data.load}ms` : 'n/a'}`,
        `  JS Heap Used:       ${cdpMetricMap.JSHeapUsedSize ? `${Math.round(cdpMetricMap.JSHeapUsedSize / 1024 / 1024)}MB` : 'n/a'}`,
        `  DOM Nodes:          ${data.domNodes ?? 'n/a'}`,
        `  Resources:          ${data.totalCount ?? 0} (${data.totalSize ? `${Math.round(data.totalSize / 1024)}KB` : '?KB'} transferred)`,
        '',
        '── Accessibility Quick Check ──',
      ];

      // a11y checks with pass/fail indicators
      const a11yChecks = [
        { label: 'Single <h1>', pass: data.h1Count === 1, detail: `found ${data.h1Count ?? 0}` },
        {
          label: 'Images have alt text',
          pass: data.imagesWithoutAlt === 0,
          detail: `${data.imagesWithoutAlt ?? 0} missing`,
        },
        {
          label: 'Buttons have type',
          pass: data.buttonsWithoutType === 0,
          detail: `${data.buttonsWithoutType ?? 0} missing`,
        },
        {
          label: 'Links have href',
          pass: data.linksWithoutHref === 0,
          detail: `${data.linksWithoutHref ?? 0} missing`,
        },
        {
          label: 'Inputs have labels',
          pass: data.formsWithoutLabels === 0,
          detail: `${data.formsWithoutLabels ?? 0} missing`,
        },
      ];

      for (const check of a11yChecks) {
        lines.push(`  ${check.pass ? '✅' : '❌'} ${check.label} (${check.detail})`);
      }

      lines.push('');
      lines.push(`💡 For a full Lighthouse audit, run: bunx lighthouse ${targetUrl} --output json`);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { success: true, metrics: data },
      };
    },
  });

  // ── Gitignore the chromium profile and screenshots ──────────────────
  pi.on('session_start', async () => {
    const gitignorePath = path.join(getRoot(), '.pi', '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (!content.includes('.chromium-profile')) {
        fs.appendFileSync(gitignorePath, '\n.chromium-profile/\n.screenshots/\n');
      }
    }
  });
}
