// .pi/extensions/moon_integration.ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  extractAffectedIds,
  filterByTaskType,
  formatDiscoveryFailure,
  formatProjectList,
  isDiscoveryEmpty,
  isDiscoveryFailure,
  parseMoonProjects,
} from './lib/output_filter';
import { runCommand } from './lib/process_runner';

/** Fallback workspace summary — used if moon query fails. Update when projects change. */
const FALLBACK_SUMMARY = `Workspace: aikami projects (moon)
Apps:  client (apps/frontend/client), site (apps/frontend/site), docs (apps/frontend/docs), image (apps/backend/image), text (apps/backend/text), voice (apps/backend/voice), e2e (apps/e2e), scripts (scripts)
Libs:  constants, schemas, types, logger, utils, mocks (packages/shared/), frontend-* (packages/frontend/), backend-* (packages/backend/)

🔴 Path prefix key: apps/frontend/ = client, site, docs | apps/backend/ = image, text, voice | packages/shared/ = constants, schemas, types, logger, utils, mocks, parser | packages/frontend/ = configs, dataconnect, engine, repositories, services, utils | packages/backend/ = ai, auth, chat, configs, database, image, svelte-kit, utils`;

export default function (pi: ExtensionAPI) {
  let workspaceSummary = FALLBACK_SUMMARY;

  /** Default timeout for short-running CLI commands (3 min). */
  const DefaultTimeoutMs = 180_000;

  /** Extended timeout for heavy tasks like builds and integration tests (5 min). */
  const HeavyTimeoutMs = 300_000;

  // ── Fetch workspace dynamically on session start ─────────────────────
  pi.on('session_start', async (_event, _ctx) => {
    try {
      const result = await runCommand('bun', ['moon', 'query', 'projects']);
      if (result.code === 0 && result.stdout) {
        const outcome = parseMoonProjects(result.stdout);
        if (outcome.kind === 'success') {
          workspaceSummary = formatProjectList(outcome.projects)
            .replace(/\*\*/g, '')
            .replace(/^/gm, 'Workspace: ');
        }
      }
    } catch {
      // Keep fallback
    }
  });

  // ── Detect Affected Projects ───────────────────────────────────────────
  pi.registerTool({
    name: 'moon_detect_affected',
    label: 'Moon: Detect Affected',
    description:
      'Detects affected projects via moon query --affected. Run BEFORE validation to know which projects changed.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      const result = await runCommand('bun', ['moon', 'query', 'projects', '--affected'], {
        signal,
        timeoutMs: DefaultTimeoutMs,
      });
      const raw = result.stdout || result.stderr;
      const outcome = extractAffectedIds(raw);

      // AC-1: Non-success outcomes report the failure instead of returning empty
      if (isDiscoveryFailure(outcome)) {
        const errorDetail = formatDiscoveryFailure(outcome);
        return {
          content: [
            { type: 'text', text: `\u274c Failed to detect affected projects:\n${errorDetail}` },
          ],
          isError: true,
          details: { code: result.code, affectedCount: 0, discoveryError: outcome.kind },
        };
      }

      if (isDiscoveryEmpty(outcome)) {
        return {
          content: [{ type: 'text', text: 'No affected projects detected.' }],
          details: { code: result.code, affectedCount: 0 },
        };
      }

      if (outcome.kind !== 'success') {
        return {
          content: [{ type: 'text', text: '\u274c Unexpected discovery outcome.' }],
          isError: true,
          details: { code: result.code },
        };
      }

      const ids = outcome.projects.map((p) => p.id);
      const apps = ids.filter((id) =>
        ['client', 'site', 'docs', 'scripts', 'e2e', 'image', 'text', 'voice'].includes(id),
      );
      const libs = ids.filter((id) => !apps.includes(id));
      const parts: string[] = [];
      if (apps.length > 0) {
        parts.push(`Apps: ${apps.join(', ')}`);
      }
      if (libs.length > 0) {
        parts.push(`Libs: ${libs.join(', ')}`);
      }
      return {
        content: [{ type: 'text', text: `**Affected (${ids.length})**: ${parts.join(' | ')}` }],
        details: { code: result.code, affectedCount: ids.length, ids },
      };
    },
  });

  // ── Run Moon Task ──────────────────────────────────────────────────────
  // 🔴 :dev and :preview tasks are LONG-RUNNING SERVERS that never exit.
  // They MUST be started via herdr_session, never through this tool.
  // Calling moon_run_task on a :dev target will hang pi indefinitely.
  const BlockedTaskSuffixes = [':dev', ':preview'];

  /**
   * Maps moon project names to herdr service keys.
   * Derived from the canonical service definitions in herdr-orchestrator.ts.
   */
  const MoonToHerdr: Record<string, string> = {
    client: 'client',
    image: 'image',
    text: 'text',
    voice: 'voice',
  };

  /** All registered herdr services (for the "try one of" list). */
  const HerdrServiceList = ['client', 'image', 'text', 'voice'];

  pi.registerTool({
    name: 'moon_run_task',
    label: 'Moon: Run Task',
    description:
      'Run a single moon task: fix, typecheck, build, test, deploy, logs, etc. ' +
      '🔴 NEVER use for :dev or :preview — these are long-running servers that hang forever. ' +
      'Use herdr_session to start dev servers instead. ' +
      'Format: <project>:<task> (e.g. client:fix, functions:typecheck).',
    promptSnippet:
      'Use moon_run_task to execute moon tasks like build, test, lint. NEVER use for :dev/:preview — use herdr_session instead.',
    parameters: Type.Object({
      target: Type.String({
        description:
          "Moon task target, e.g. 'client:typecheck', 'schemas:build'. " +
          "🔴 Do NOT use ':dev' or ':preview' — these hang forever. Use herdr_session for dev servers.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const target = params.target as string;

      // ── Block long-running server tasks ──────────────────────
      for (const suffix of BlockedTaskSuffixes) {
        if (target.endsWith(suffix)) {
          const moonProject = target.replace(suffix, '');
          const herdrService = MoonToHerdr[moonProject];

          if (herdrService) {
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `🔴 BLOCKED: "${target}" is a long-running dev server — it would hang pi forever.\n\n` +
                    `Use herdr_session instead:\n` +
                    `  herdr_session start ${herdrService}\n\n` +
                    `Other registered herdr services: ${HerdrServiceList.join(', ')}\n` +
                    `herdr runs dev servers in persistent background sessions that survive pi restarts.`,
                },
              ],
              isError: true,
              details: { blocked: true, suggestion: `herdr_session start ${herdrService}` },
            };
          }

          // Unknown project — no herdr mapping exists
          return {
            content: [
              {
                type: 'text',
                text:
                  `🔴 BLOCKED: "${target}" is a long-running dev server — it would hang pi forever.\n\n` +
                  `"${moonProject}" is not registered as a herdr service.\n` +
                  `Registered herdr services: ${HerdrServiceList.join(', ')}\n\n` +
                  `Options:\n` +
                  `  1. Start it manually in a terminal:  bun moon run ${target}\n` +
                  `  2. If this should be a permanent herdr service, add it to:\n` +
                  `     • .pi/extensions/herdr-orchestrator.ts\n` +
                  `     • scripts/src/lib/herdr/session.ts\n\n` +
                  `herdr runs dev servers in persistent background sessions that survive pi restarts.`,
              },
            ],
            isError: true,
            details: { blocked: true, unknownProject: moonProject },
          };
        }
      }

      const result = await runCommand('bun', ['moon', 'run', params.target], {
        signal,
        timeoutMs: DefaultTimeoutMs,
      });
      const raw = result.stdout || result.stderr || '';
      const filtered = filterByTaskType(raw, target);
      return {
        content: [{ type: 'text', text: filtered }],
        details: { code: result.code },
      };
    },
  });

  // ── List Projects ──────────────────────────────────────────────────────
  pi.registerTool({
    name: 'moon_list_projects',
    label: 'Moon: List Projects',
    description: 'List all monorepo projects registered in moon with tags and deps.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      const result = await runCommand('bun', ['moon', 'query', 'projects'], {
        signal,
        timeoutMs: DefaultTimeoutMs,
      });
      const raw = result.stdout || result.stderr;
      const outcome = parseMoonProjects(raw);

      // AC-1: Discovery failure is reported distinctly
      if (isDiscoveryFailure(outcome)) {
        const errorDetail = formatDiscoveryFailure(outcome);
        return {
          content: [{ type: 'text', text: `\u274c Failed to query projects:\n${errorDetail}` }],
          isError: true,
          details: { code: result.code, discoveryError: outcome.kind },
        };
      }

      if (outcome.kind === 'success') {
        return {
          content: [{ type: 'text', text: formatProjectList(outcome.projects) }],
          details: { code: result.code, projectCount: outcome.projects.length },
        };
      }

      // Empty or no-projects — still valid, just no results
      return {
        content: [{ type: 'text', text: 'No projects found.' }],
        details: { code: result.code, projectCount: 0 },
      };
    },
  });

  // ── Batch Validate ────────────────────────────────────────────────────
  pi.registerTool({
    name: 'validate',
    label: 'Batch Validate',
    description:
      'Validate changed projects: detect affected → run fix+typecheck → optionally build+test. ' +
      'Use at END of feature, not during development. No test-runner string — moon handles caching.',
    promptSnippet:
      'Use validate at the end of a feature to run fix+typecheck+build+test on all affected projects.',
    parameters: Type.Object({
      test: Type.Optional(
        Type.Boolean({
          description: 'If true, also run build + tests after fix+typecheck pass.',
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description:
            'Max execution time per phase in seconds. Default: 180 (3 min). Increase for large test suites (e.g. 600 for full E2E).',
          minimum: 10,
          maximum: 900,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const errors: string[] = [];
      const ok: string[] = [];

      // Allow AI to override timeout via timeoutSeconds (seconds → ms)
      const phaseTimeoutMs = params.timeoutSeconds
        ? params.timeoutSeconds * 1000
        : DefaultTimeoutMs;
      const heavyTimeoutMs = params.timeoutSeconds
        ? Math.max(params.timeoutSeconds * 1000, HeavyTimeoutMs)
        : HeavyTimeoutMs;

      // 1. Detect affected
      const affectedResult = await runCommand('bun', ['moon', 'query', 'projects', '--affected'], {
        signal,
        timeoutMs: DefaultTimeoutMs,
      });
      const affectedOutcome = extractAffectedIds(affectedResult.stdout || '');

      // AC-1: Discovery failure is NOT treated as "no changes"
      if (isDiscoveryFailure(affectedOutcome)) {
        const errorDetail = formatDiscoveryFailure(affectedOutcome);
        return {
          content: [
            {
              type: 'text',
              text: `\u274c Cannot validate — failed to detect affected projects:\n${errorDetail}`,
            },
          ],
          isError: true,
          details: { code: 1, discoveryError: affectedOutcome.kind },
        };
      }

      if (isDiscoveryEmpty(affectedOutcome)) {
        return {
          content: [{ type: 'text', text: 'No affected projects. Nothing to validate.' }],
          details: { code: 0 },
        };
      }

      // After excluding failure and empty, only success with projects remains
      if (affectedOutcome.kind !== 'success') {
        return {
          content: [
            { type: 'text', text: '\u274c Cannot validate — unexpected discovery outcome.' },
          ],
          isError: true,
          details: { code: 1 },
        };
      }
      const affectedProjects = affectedOutcome.projects;
      const projList = affectedProjects.map((p) => p.id).join(', ');
      const detailSections: string[] = [];

      // 2. Run fix + typecheck via workspace-level --affected.
      // --concurrency 4 caps parallel project builds to prevent OOM crashes.
      const fixResult = await runCommand(
        'bun',
        ['moon', 'run', ':fix', '--affected', '--concurrency', '4'],
        { signal, timeoutMs: phaseTimeoutMs },
      );
      if (fixResult.code !== 0) {
        errors.push(':fix');
        detailSections.push(
          `**:fix** ❌\n${filterByTaskType(fixResult.stdout || fixResult.stderr || '', 'root:fix')}`,
        );
      } else {
        ok.push(':fix');
      }

      const tcResult = await runCommand(
        'bun',
        ['moon', 'run', ':typecheck', '--affected', '--concurrency', '4'],
        { signal, timeoutMs: phaseTimeoutMs },
      );
      if (tcResult.code !== 0) {
        errors.push(':typecheck');
        detailSections.push(
          `**::typecheck** ❌\n${filterByTaskType(tcResult.stdout || tcResult.stderr || '', 'root:typecheck')}`,
        );
      } else {
        ok.push(':typecheck');
      }

      // 3. Build + test (optional, only if fix+typecheck passed)
      if (params.test && errors.length === 0) {
        const buildResult = await runCommand(
          'bun',
          ['moon', 'run', ':build', '--affected', '--concurrency', '4'],
          { signal, timeoutMs: heavyTimeoutMs },
        );
        if (buildResult.code !== 0) {
          errors.push(':build');
          detailSections.push(
            `**::build** ❌\n${filterByTaskType(buildResult.stdout || buildResult.stderr || '', 'root:build')}`,
          );
        } else {
          ok.push(':build');
        }

        const testResult = await runCommand(
          'bun',
          ['moon', 'run', ':test', '--affected', '--concurrency', '4'],
          { signal, timeoutMs: heavyTimeoutMs },
        );
        if (testResult.code !== 0) {
          errors.push(':test');
          detailSections.push(
            `**::test** ❌\n${filterByTaskType(testResult.stdout || testResult.stderr || '', 'root:test')}`,
          );
        } else {
          ok.push(':test');
        }
      }

      // 4. Report
      let report = `Projects: ${projList}\n\n`;
      report += `✅ ${ok.length} passed\n`;
      if (errors.length > 0) {
        report += `❌ ${errors.length} failed: ${errors.join(', ')}\n`;
        if (detailSections.length > 0) {
          report += `\n── Details ──\n${detailSections.join('\n\n')}\n`;
        }
      }

      return {
        content: [{ type: 'text', text: report }],
        details: { code: errors.length > 0 ? 1 : 0 },
      };
    },
  });

  // ── Blackbox Test Runner ───────────────────────────────────────────
  pi.registerTool({
    name: 'blackbox_test',
    label: 'Test: Blackbox',
    description:
      'Runs blackbox integration tests against local emulators + dev servers. ' +
      'Starts/stops emulators and dev servers automatically. ' +
      'Suites: schema-check, functions, client, site, docs, cross-service.',
    parameters: Type.Object({
      suites: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Specific suites to run: schema-check, functions, client, site, docs, cross-service. Omit to run all.',
          default: [],
        }),
      ),
      noCrossService: Type.Optional(
        Type.Boolean({
          description: 'Skip cross-service tests (faster iteration)',
          default: false,
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description:
            'Max execution time in seconds. Default: 300 (5 min). Increase for full suite runs.',
          minimum: 30,
          maximum: 900,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const args = ['run', 'test:blackbox'];
      if (params.suites && params.suites.length > 0) {
        args.push(...params.suites);
      }
      if (params.noCrossService) {
        args.push('--no-cross-service');
      }

      const testTimeoutMs = params.timeoutSeconds ? params.timeoutSeconds * 1000 : HeavyTimeoutMs;

      _onUpdate?.({
        content: [
          {
            type: 'text',
            text: `Running blackbox tests (${params.suites?.join(', ') || 'all'})...`,
          },
        ],
        details: {},
      });

      const result = await runCommand('bun', args, { signal, timeoutMs: testTimeoutMs });

      // Try to parse JSON report for structured output
      let parsedReport: Record<string, unknown> | null = null;
      try {
        const jsonMatch = (result.stdout || '').match(/\{[\s\S]*"suites"[\s\S]*\}/);
        if (jsonMatch) {
          parsedReport = JSON.parse(jsonMatch[0]);
        }
      } catch {
        /* use raw output */
      }

      if (parsedReport) {
        const lines = [
          `**Blackbox Results** (${parsedReport.duration}ms)`,
          `Passed: ${parsedReport.passed} | Failed: ${parsedReport.failed} | Skipped: ${parsedReport.skipped}`,
          '',
        ];
        for (const s of parsedReport.suites as Array<{
          status: string;
          name: string;
          duration: number;
          error?: string;
        }>) {
          let icon: string;
          if (s.status === 'pass') {
            icon = '✅';
          } else if (s.status === 'fail') {
            icon = '❌';
          } else {
            icon = '⏭️';
          }
          lines.push(`${icon} **${s.name}** (${s.duration}ms)`);
          if (s.error) {
            lines.push(`   Error: ${s.error.slice(0, 200)}`);
          }
        }
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { code: result.code, ...parsedReport },
        };
      }

      return {
        content: [{ type: 'text', text: result.stdout || result.stderr }],
        details: { code: result.code },
      };
    },
  });

  // ── Lightweight workspace context (dynamically fetched) ────────────
  pi.on('before_agent_start', async (event, _ctx) => {
    const modeInfo = process.env.AIKAMI_MODE
      ? '\nDirenv: AIKAMI_MODE=' +
        process.env.AIKAMI_MODE +
        '  project=' +
        (process.env.AIKAMI_PROJECT_ID || '?')
      : '';

    // The path prefix key is always shown so Pi never hallucinates flat paths.
    const pathPrefixKey =
      '\n🔴 Path prefix key: apps/frontend/ = client, site, docs | apps/backend/ = firebase, image, text, voice | packages/shared/ = constants, schemas, types, logger, utils, mocks, parser | packages/frontend/ = configs, dataconnect, engine, repositories, services, utils | packages/backend/ = ai, auth, chat, configs, database, image, svelte-kit, utils';

    const devServerRule =
      '\n🔴 NEVER call moon_run_task for :dev or :preview targets — these are long-running servers that hang forever. Use herdr_session start <service> instead. Registered herdr services: client, image, text, voice.';
    return {
      systemPrompt: `${event.systemPrompt}\n${workspaceSummary}${pathPrefixKey}${modeInfo}${devServerRule}`,
    };
  });
}
