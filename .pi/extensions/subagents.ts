// .pi/extensions/subagents.ts
//
// `subagent` — let a captain agent delegate work to pi subagents that run in
// herdr tabs (read agents) or herdr worktrees (write agents), in the
// background or blocking, and get woken when they finish.
//
// Division of labour:
//   - Mutations (spawn / message / kill / cleanup) → bridge → Bun
//     (scripts/src/lib/agents/subagents/*, also usable as `bun run subagent`).
//   - Observation (wait / status / list / result / notifications) → direct,
//     read-only fs reads of .pi/subagent-runs/<id>/state.json (lib/subagent_watch.ts).
//
// Each subagent runs under a detached supervisor process that owns the pi
// child, so completion is an exit code — and the run survives the captain's
// turn ending, the captain being restarted, or even the captain crashing.

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SpawnResult, SubagentState } from '../../scripts/src/lib/agents/subagents/types.ts';
import { REPO_ROOT, runPiScript } from './lib/bridge.ts';
import {
  headline,
  isTerminalStatus,
  listRunIds,
  mainRepoRoot,
  type RunSnapshot,
  readRun,
  report,
} from './lib/subagent_watch.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

const POLL_MS = 1_500;
const PROGRESS_MS = 3_000;
const DEFAULT_WAIT_MS = 30 * 60_000;
const MAX_WAIT_MS = 3 * 60 * 60_000;
const NOTIFY_RESULT_CHARS = 4_000;
const RESULT_CHARS = 12_000;
/** Bridge budget for spawn — a write agent may run `bun install` in its worktree. */
const SPAWN_TIMEOUT_MS = 10 * 60_000;

type Text = { type: 'text'; text: string };
const text = (t: string): Text[] => [{ type: 'text', text: t }];

const THINKING = Type.Optional(
  Type.Union(
    ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((l) => Type.Literal(l)),
    { description: 'Thinking level (default: SUBAGENT_THINKING env or medium)' },
  ),
);

const PR_SCHEMA = Type.Optional(
  Type.Union(
    [
      Type.Boolean(),
      Type.Object({
        base: Type.Optional(Type.String()),
        title: Type.Optional(Type.String({ description: 'Default: agent-provided TITLE line' })),
        draft: Type.Optional(Type.Boolean()),
        review: Type.Optional(
          Type.Union([Type.Literal('auto'), Type.Literal('always'), Type.Literal('never')], {
            description:
              'CodeRabbit: auto (skip trivial / docs-only / >100 files / within 1h cooldown), always, never',
          }),
        ),
        autofix: Type.Optional(
          Type.Boolean({ description: 'Post @coderabbitai autofix when the review has findings' }),
        ),
        reviewTimeoutMinutes: Type.Optional(Type.Number()),
      }),
    ],
    {
      description:
        'Write agents: open a PR on success (default true). false = leave changes in the worktree',
    },
  ),
);

export default function (pi: ExtensionAPI) {
  // 🔴 Subagents never get this tool — no recursion, and no prompt cost.
  if (Number(process.env.SUBAGENT_DEPTH ?? '0') > 0) {
    return;
  }

  const repoRoot = mainRepoRoot(REPO_ROOT);
  /** Runs this captain wants a completion notification for. */
  const watched = new Set<string>();
  /** Runs currently inside a blocking wait — their result is delivered by the tool. */
  const awaiting = new Map<string, number>();
  let ticker: NodeJS.Timeout | undefined;

  const notify = (run: RunSnapshot): void => {
    pi.sendMessage(
      {
        customType: 'subagent-complete',
        content:
          `${report(repoRoot, run, NOTIFY_RESULT_CHARS)}\n\n` +
          `More: subagent.result {id:"${run.spec.id}"} · follow up: subagent.message · done: subagent.cleanup`,
        display: true,
        details: { id: run.spec.id, status: run.state.status, pr: run.state.pr },
      },
      { triggerTurn: true, deliverAs: 'followUp' },
    );
  };

  /** Notify + stop watching once a run is terminal (or its record vanished). */
  const settle = (id: string): void => {
    const run = readRun(repoRoot, id);
    if (run && !isTerminalStatus(run.state.status)) {
      return;
    }
    watched.delete(id);
    if (run) {
      notify(run);
    }
  };

  const tick = (): void => {
    for (const id of [...watched].filter((w) => !awaiting.has(w))) {
      settle(id);
    }
    if (watched.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };

  const watch = (id: string): void => {
    watched.add(id);
    ticker ??= setInterval(tick, POLL_MS * 2);
  };

  // Re-attach to this session's still-running agents after a captain restart.
  pi.on('session_start', (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    for (const id of listRunIds(repoRoot)) {
      const run = readRun(repoRoot, id);
      if (run && run.spec.captainSessionId === sessionId && !isTerminalStatus(run.state.status)) {
        watch(id);
      }
    }
  });

  const snapshot = (ids: string[]): RunSnapshot[] =>
    ids.map((id) => readRun(repoRoot, id)).filter((r): r is RunSnapshot => r !== undefined);

  const isSatisfied = (runs: RunSnapshot[], mode: 'all' | 'any'): boolean => {
    const done = runs.filter((r) => isTerminalStatus(r.state.status)).length;
    return mode === 'any' ? done > 0 : done === runs.length;
  };

  const hold = (ids: string[], delta: 1 | -1): void => {
    for (const id of ids) {
      const n = (awaiting.get(id) ?? 0) + delta;
      if (n <= 0) {
        awaiting.delete(id);
      } else {
        awaiting.set(id, n);
      }
    }
  };

  type WaitOutcome = 'done' | 'timeout' | 'aborted';

  /** Block until all/any of `ids` are terminal, streaming progress. */
  const waitFor = async (options: {
    ids: string[];
    mode: 'all' | 'any';
    timeoutMs: number;
    signal: AbortSignal | undefined;
    onUpdate: ((r: { content: Text[]; details: unknown }) => void) | undefined;
  }): Promise<{ runs: RunSnapshot[]; outcome: WaitOutcome }> => {
    const deadline = Date.now() + options.timeoutMs;
    const outcomeOf = (runs: RunSnapshot[]): WaitOutcome | undefined => {
      if (isSatisfied(runs, options.mode)) {
        return 'done';
      }
      if (options.signal?.aborted) {
        return 'aborted';
      }
      return Date.now() >= deadline ? 'timeout' : undefined;
    };
    const progress = (runs: RunSnapshot[]): void => {
      options.onUpdate?.({ content: text(runs.map(headline).join('\n')), details: {} });
    };
    hold(options.ids, 1);
    try {
      let runs = snapshot(options.ids);
      let outcome = outcomeOf(runs);
      let lastProgress = 0;
      while (!outcome) {
        if (Date.now() - lastProgress >= PROGRESS_MS) {
          lastProgress = Date.now();
          progress(runs);
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        runs = snapshot(options.ids);
        outcome = outcomeOf(runs);
      }
      // Finished runs are delivered via this tool result — no duplicate wake-up.
      for (const r of runs.filter((x) => isTerminalStatus(x.state.status))) {
        watched.delete(r.spec.id);
      }
      // An explicit wait is an implicit request for completion notification.
      // This matters for notify:false runs and wait_all, whose ids were not
      // registered in `watched` at spawn time.
      for (const r of runs.filter((x) => !isTerminalStatus(x.state.status))) {
        watch(r.spec.id);
      }
      return { runs, outcome };
    } finally {
      hold(options.ids, -1);
    }
  };

  const waitResult = (
    runs: RunSnapshot[],
    outcome: 'done' | 'timeout' | 'aborted',
    mode: 'all' | 'any',
  ) => {
    const finished = runs.filter((r) => isTerminalStatus(r.state.status));
    const pending = runs.filter((r) => !isTerminalStatus(r.state.status));
    const perRun = Math.max(2_000, Math.floor(RESULT_CHARS / Math.max(1, finished.length)));
    const parts = finished.map((r) => report(repoRoot, r, perRun));
    if (pending.length > 0) {
      parts.push(
        (outcome === 'done' && mode === 'any'
          ? 'Still running:'
          : `⏳ ${outcome} — still running (not killed):`) +
          `\n${pending.map(headline).join('\n')}\n` +
          'You will be notified when they finish; or call subagent.wait again.',
      );
    }
    return {
      content: text(parts.join('\n\n════════\n\n') || 'No matching subagents.'),
      isError: finished.some((r) => r.state.status !== 'succeeded') || undefined,
      details: { runs: runs.map((r) => ({ id: r.spec.id, status: r.state.status })), outcome },
    };
  };

  const resolveModelParam = (
    model: string | undefined,
    ctx: ExtensionContext,
  ): string | undefined =>
    model === 'inherit' && ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : model;

  const missing = (id: string) => ({
    content: text(
      `❌ No subagent "${id}". Known: ${listRunIds(repoRoot).slice(-10).join(', ') || '(none)'}`,
    ),
    isError: true,
    details: {},
  });

  registerNamespace(pi, {
    name: 'subagent',
    label: 'Subagents',
    description:
      'Delegate tasks to pi subagents running in herdr. kind=read (default): investigation/review in the main ' +
      'checkout, mutation tools removed, no worktree. kind=write: isolated herdr worktree (returned checkoutPath ' +
      'lets you read its code), auto PR to main with optional CodeRabbit review/autofix. Background by default: ' +
      'you are woken with the result when each finishes — keep working, then subagent.wait / wait_all only when ' +
      'you have nothing else to do. Default model is a FREE stealth model; pass model "inherit" for yours, ' +
      '"pro"/"flash" for .env tiers, or provider/id. Give each agent a self-contained task — it cannot ask you questions.',
    promptSnippet:
      'Use subagent to fan out independent research (kind read) or isolated implementation (kind write, PR) in parallel',
    actions: [
      defineAction({
        action: 'spawn',
        summary: 'Start a subagent (background by default; wait:true blocks until done)',
        parameters: Type.Object({
          name: Type.String({ description: 'Short label, e.g. "audit-hub-auth"' }),
          task: Type.String({ description: 'Self-contained instructions + acceptance criteria' }),
          kind: Type.Optional(Type.Union([Type.Literal('read'), Type.Literal('write')])),
          wait: Type.Optional(
            Type.Boolean({ description: 'Block until finished (default false)' }),
          ),
          context: Type.Optional(
            Type.String({ description: 'Extra context appended to its system prompt' }),
          ),
          model: Type.Optional(
            Type.String({ description: 'provider/id | inherit | pro | flash | free | stealth' }),
          ),
          thinking: THINKING,
          skills: Type.Optional(
            Type.Array(Type.String(), {
              description: 'Skill names to INLINE, e.g. ["aikami-conventions"]',
            }),
          ),
          noSkillDiscovery: Type.Optional(
            Type.Boolean({ description: 'Leaner prompt: no skill index' }),
          ),
          tools: Type.Optional(
            Type.Array(Type.String(), { description: 'Explicit tool allowlist' }),
          ),
          excludeTools: Type.Optional(Type.Array(Type.String())),
          base: Type.Optional(Type.String({ description: 'Worktree base ref (default main)' })),
          install: Type.Optional(
            Type.Boolean({ description: 'bun install in the worktree (default true)' }),
          ),
          reuseCheckout: Type.Optional(
            Type.String({
              description: 'Work in an existing worktree path instead of creating one',
            }),
          ),
          pr: PR_SCHEMA,
          timeoutMinutes: Type.Optional(Type.Number({ description: 'Kill after (default 45)' })),
          notify: Type.Optional(
            Type.Boolean({ description: 'Wake me on completion (default true)' }),
          ),
        }),
        async execute(_id, params, signal, onUpdate, ctx) {
          const r = await runPiScript<SpawnResult>(
            'subagent.spawn',
            {
              ...params,
              model: resolveModelParam(params.model, ctx),
              repoRoot,
              captainSessionId: ctx.sessionManager.getSessionId(),
            },
            { timeoutMs: SPAWN_TIMEOUT_MS, signal },
          );
          if (params.notify ?? true) {
            watch(r.id);
          }
          if (params.wait) {
            const { runs, outcome } = await waitFor({
              ids: [r.id],
              mode: 'all',
              timeoutMs: MAX_WAIT_MS,
              signal,
              onUpdate,
            });
            return waitResult(runs, outcome, 'all');
          }
          const where = r.checkoutPath ? `\ncheckout: ${r.checkoutPath} (branch ${r.branch})` : '';
          return {
            content: text(
              `🚀 ${r.id} started (${r.kind}) · model ${r.model}${r.thinking ? `:${r.thinking}` : ''} [${r.modelSource}]` +
                `${where}${r.workspaceId ? `\nherdr: workspace ${r.workspaceId}, pane ${r.paneId}` : ''}\n` +
                ((params.notify ?? true)
                  ? 'Runs in the background — you will be woken with its result. Keep working.'
                  : 'notify:false — collect with subagent.wait.'),
            ),
            details: r,
          };
        },
      }),

      defineAction({
        action: 'wait',
        summary: 'Block until one subagent finishes; returns its result',
        parameters: Type.Object({
          id: Type.String(),
          timeoutMinutes: Type.Optional(Type.Number({ default: 30 })),
        }),
        async execute(_id, params, signal, onUpdate) {
          if (!readRun(repoRoot, params.id)) {
            return missing(params.id);
          }
          const { runs, outcome } = await waitFor({
            ids: [params.id],
            mode: 'all',
            timeoutMs: Math.min((params.timeoutMinutes ?? 30) * 60_000, MAX_WAIT_MS),
            signal,
            onUpdate,
          });
          return waitResult(runs, outcome, 'all');
        },
      }),

      defineAction({
        action: 'wait_all',
        summary: 'Block until all (or any) of the given / all active subagents finish',
        parameters: Type.Object({
          ids: Type.Optional(
            Type.Array(Type.String(), { description: 'Default: every active run of this session' }),
          ),
          mode: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('any')])),
          timeoutMinutes: Type.Optional(Type.Number({ default: 30 })),
        }),
        async execute(_id, params, signal, onUpdate, ctx) {
          const sessionId = ctx.sessionManager.getSessionId();
          const ids =
            params.ids ??
            listRunIds(repoRoot).filter((id) => {
              const run = readRun(repoRoot, id);
              return (
                run &&
                run.spec.captainSessionId === sessionId &&
                (!isTerminalStatus(run.state.status) || watched.has(id))
              );
            });
          if (ids.length === 0) {
            return { content: text('No active subagents in this session.'), details: {} };
          }
          const mode = params.mode ?? 'all';
          const { runs, outcome } = await waitFor({
            ids,
            mode,
            timeoutMs: Math.min(
              (params.timeoutMinutes ?? DEFAULT_WAIT_MS / 60_000) * 60_000,
              MAX_WAIT_MS,
            ),
            signal,
            onUpdate,
          });
          return waitResult(runs, outcome, mode);
        },
      }),

      defineAction({
        action: 'status',
        summary: 'Snapshot of one subagent (no waiting)',
        parameters: Type.Object({ id: Type.String() }),
        async execute(_id, params) {
          const run = readRun(repoRoot, params.id);
          if (!run) {
            return missing(params.id);
          }
          const body = isTerminalStatus(run.state.status)
            ? report(repoRoot, run, 1_500)
            : headline(run);
          return { content: text(body), details: run.state };
        },
      }),

      defineAction({
        action: 'list',
        summary: 'List subagents (this session by default)',
        parameters: Type.Object({
          scope: Type.Optional(
            Type.Union([Type.Literal('session'), Type.Literal('active'), Type.Literal('all')]),
          ),
        }),
        async execute(_id, params, _signal, _onUpdate, ctx) {
          const scope = params.scope ?? 'session';
          const sessionId = ctx.sessionManager.getSessionId();
          const runs = listRunIds(repoRoot)
            .map((id) => readRun(repoRoot, id))
            .filter((r): r is RunSnapshot => r !== undefined)
            .filter((r) => {
              if (scope === 'all') {
                return true;
              }
              if (scope === 'active') {
                return !isTerminalStatus(r.state.status);
              }
              return r.spec.captainSessionId === sessionId;
            })
            .sort((a, b) => a.spec.createdAt.localeCompare(b.spec.createdAt));
          return {
            content: text(runs.map(headline).join('\n') || `No subagents (${scope}).`),
            details: { ids: runs.map((r) => r.spec.id) },
          };
        },
      }),

      defineAction({
        action: 'result',
        summary: 'Full report + final answer of a finished subagent',
        parameters: Type.Object({
          id: Type.String(),
          maxChars: Type.Optional(Type.Number({ default: RESULT_CHARS })),
        }),
        async execute(_id, params) {
          const run = readRun(repoRoot, params.id);
          if (!run) {
            return missing(params.id);
          }
          return {
            content: text(report(repoRoot, run, params.maxChars ?? RESULT_CHARS)),
            details: run.state,
          };
        },
      }),

      defineAction({
        action: 'message',
        summary:
          'Queue steering for a running subagent, or resume a finished one in the same session/worktree',
        parameters: Type.Object({
          id: Type.String(),
          text: Type.String(),
          delivery: Type.Optional(
            Type.Union([Type.Literal('steer'), Type.Literal('followUp')], {
              description: 'Queued at the next safe JSON-mode process boundary; defaults to steer',
            }),
          ),
          wait: Type.Optional(Type.Boolean()),
        }),
        async execute(_id, params, signal, onUpdate) {
          const before = readRun(repoRoot, params.id);
          const next = await runPiScript<SubagentState>(
            'subagent.message',
            {
              repoRoot,
              id: params.id,
              text: params.text,
              delivery: params.delivery ?? 'steer',
            },
            { signal },
          );
          // Explicit interaction re-attaches completion notification even when
          // the run was originally spawned with notify:false.
          watch(params.id);
          if (params.wait) {
            const { runs, outcome } = await waitFor({
              ids: [params.id],
              mode: 'all',
              timeoutMs: MAX_WAIT_MS,
              signal,
              onUpdate,
            });
            return waitResult(runs, outcome, 'all');
          }
          const action =
            before && !isTerminalStatus(before.state.status)
              ? `📨 queued ${params.delivery ?? 'steer'} (${next.queuedMessages ?? 1} pending)`
              : `📨 resumed ${params.delivery ?? 'follow-up'}`;
          return {
            content: text(`${action} for ${params.id} — you will be notified.`),
            details: next,
          };
        },
      }),

      defineAction({
        action: 'kill',
        summary: 'Stop a running subagent',
        parameters: Type.Object({ id: Type.String() }),
        async execute(_id, params) {
          const s = await runPiScript<SubagentState>('subagent.kill', { repoRoot, id: params.id });
          watched.delete(params.id);
          return { content: text(`🛑 ${params.id}: ${s.status}`), details: s };
        },
      }),

      defineAction({
        action: 'cleanup',
        summary: 'Close its tab / remove its worktree (branch kept while a PR exists)',
        parameters: Type.Object({
          id: Type.String(),
          removeWorktree: Type.Optional(Type.Boolean({ default: true })),
          purge: Type.Optional(Type.Boolean({ description: 'Also delete the run record' })),
          force: Type.Optional(Type.Boolean()),
        }),
        async execute(_id, params) {
          const done = await runPiScript<string[]>(
            'subagent.cleanup',
            { repoRoot, ...params },
            { timeoutMs: 120_000 },
          );
          return {
            content: text(done.map((d) => `✓ ${d}`).join('\n') || 'Nothing to clean.'),
            details: {},
          };
        },
      }),

      defineAction({
        action: 'models',
        summary: 'Show the default subagent model and available free/stealth models',
        parameters: Type.Object({}),
        async execute() {
          const m = await runPiScript<{
            default: { model: string; source: string };
            stealth: string[];
            free: string[];
          }>('subagent.models', { repoRoot });
          return {
            content: text(
              `default: ${m.default.model} (${m.default.source})\n` +
                `stealth (free): ${m.stealth.join(', ') || 'none'}\n` +
                `other :free: ${m.free.slice(0, 15).join(', ')}`,
            ),
            details: m,
          };
        },
      }),
    ],
  });
}
