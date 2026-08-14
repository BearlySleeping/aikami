// .pi/extensions/poll_until.ts
//
// Polling for external state that has NO exit event to wait on: a dev server
// becoming healthy, a CI run finishing, a deploy going live, an emulator port
// opening, a queue draining.
//
// 🔴 If you launched the process yourself, this is the WRONG tool — use `bg`,
// where the exit code answers exactly. Polling only earns its keep when the
// thing being watched outlives the command that inspects it.
//
// Completion predicates, in strict priority order:
//
//   1. failureRegex  — checked FIRST, so a fast failure is never mistaken for
//                      "not ready yet" and waited on until timeout.
//   2. successRegex  — the explicit, reliable signal. Prefer this always.
//   3. expectExitCode — the probe command's own exit status.
//   4. stableFor     — LAST RESORT. "output stopped changing for N samples."
//
// (4) is opt-in and never the default, because it is a genuine heuristic:
// a silent linking phase looks identical to a finished build. It exists for
// verbose external processes with no other signal, and even then it demands
// several consecutive identical samples of NORMALISED output (see
// lib/output_normalize.ts — without that, ANSI progress bars mean the output
// never repeats and the poll always runs to timeout).

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { abortableSleep, formatDuration } from './lib/async.ts';
import {
  firstSleepMs,
  getDurationPrior,
  nextIntervalMs,
  recordDuration,
} from './lib/duration_cache.ts';
import { displayTail, outputFingerprint } from './lib/output_normalize.ts';
import { runCommand } from './lib/process_runner.ts';

// ── Tuning ─────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
const MAX_MAX_WAIT_MS = 60 * 60_000;

/** Per-probe timeout — a probe that hangs must not consume the whole budget. */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * Minimum consecutive identical samples before `stableFor` may declare
 * completion. Two is far too eager: any two adjacent quiet moments in a build
 * would trip it.
 */
const MIN_STABLE_SAMPLES = 3;

const DEFAULT_TAIL_LINES = 30;

// ── Outcome ────────────────────────────────────────────────────────

type Outcome =
  | 'success_regex'
  | 'failure_regex'
  | 'exit_code'
  | 'stable_output'
  | 'timeout'
  | 'aborted';

const OUTCOME_TEXT: Record<Outcome, string> = {
  success_regex: '✅ Matched successRegex',
  failure_regex: '❌ Matched failureRegex',
  exit_code: '✅ Probe returned the expected exit code',
  stable_output: '✅ Output stable (heuristic — verify if this matters)',
  timeout: '⏱️ Timed out',
  aborted: '🛑 Cancelled',
};

const _isFailure = (outcome: Outcome): boolean =>
  outcome === 'failure_regex' || outcome === 'timeout' || outcome === 'aborted';

/** Compiles a user-supplied pattern, reporting a bad regex instead of throwing. */
const _compile = (
  pattern: string | undefined,
  label: string,
): RegExp | { error: string } | undefined => {
  if (!pattern) {
    return undefined;
  }
  try {
    return new RegExp(pattern, 'm');
  } catch (err) {
    return { error: `${label} is not a valid regular expression: ${(err as Error).message}` };
  }
};

const _isError = (value: unknown): value is { error: string } =>
  typeof value === 'object' && value !== null && 'error' in value;

// ── Extension ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'poll_until',
    label: 'Poll Until',
    description:
      'Repeatedly run a probe command until it reports a terminal state, then return once. ' +
      'For EXTERNAL state with no exit event to wait on — service health, CI runs, deploys, ' +
      'queue depth. If you started the process yourself, use `bg` instead: its exit code is ' +
      'exact where polling is inference. Predicates are checked in order: failureRegex, ' +
      'successRegex, expectExitCode, then stableFor (a heuristic, opt-in only).',
    promptSnippet:
      'Use poll_until to wait on external state (service health, CI, deploys) in one tool call',
    parameters: Type.Object({
      command: Type.String({
        description:
          'Probe command, run once per interval. Must be cheap and side-effect free, ' +
          'e.g. "curl -sf localhost:5173/health" or "gh run view 123 --json status -q .status".',
      }),
      successRegex: Type.Optional(
        Type.String({ description: 'Terminal success when this matches the probe output.' }),
      ),
      failureRegex: Type.Optional(
        Type.String({ description: 'Terminal failure when this matches. Checked before success.' }),
      ),
      expectExitCode: Type.Optional(
        Type.Number({ description: 'Terminal success when the probe exits with this code.' }),
      ),
      stableFor: Type.Optional(
        Type.Number({
          default: 0,
          description:
            'HEURISTIC, opt-in. Declare done after N consecutive identical (normalised) outputs. ' +
            `Minimum ${MIN_STABLE_SAMPLES}. Only for verbose processes with no better signal.`,
        }),
      ),
      intervalMs: Type.Optional(Type.Number({ default: DEFAULT_INTERVAL_MS })),
      maxWaitMs: Type.Optional(Type.Number({ default: DEFAULT_MAX_WAIT_MS })),
      cwd: Type.Optional(Type.String()),
      tailLines: Type.Optional(Type.Number({ default: DEFAULT_TAIL_LINES })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const successRe = _compile(params.successRegex, 'successRegex');
      const failureRe = _compile(params.failureRegex, 'failureRegex');
      for (const compiled of [successRe, failureRe]) {
        if (_isError(compiled)) {
          return {
            content: [{ type: 'text', text: `❌ ${compiled.error}` }],
            isError: true,
            details: { error: 'bad_regex' },
          };
        }
      }

      const stableFor = params.stableFor ?? 0;
      const wantsStability = stableFor > 0;
      const requiredStable = Math.max(stableFor, MIN_STABLE_SAMPLES);

      // Refuse a poll with no way to ever succeed rather than burning the
      // whole budget and reporting a timeout.
      if (!successRe && !failureRe && params.expectExitCode === undefined && !wantsStability) {
        return {
          content: [
            {
              type: 'text',
              text:
                '❌ poll_until needs at least one completion predicate: successRegex, ' +
                'failureRegex, expectExitCode, or stableFor. Without one it can only time out.',
            },
          ],
          isError: true,
          details: { error: 'no_predicate' },
        };
      }

      const cwd = params.cwd ?? process.cwd();
      const maxWaitMs = Math.min(params.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, MAX_MAX_WAIT_MS);
      const baseInterval = Math.max(500, params.intervalMs ?? DEFAULT_INTERVAL_MS);
      const deadline = Date.now() + maxWaitMs;
      const startedAt = Date.now();

      // Learned duration prior: sleep most of the expected wait before the
      // first probe instead of sampling a known-4-minute wait 48 times. This
      // only changes WHEN we look, never WHETHER we call it done.
      const prior = getDurationPrior(`poll:${params.command}`, { cwd });

      let attempts = 0;
      let interval = baseInterval;
      let lastFingerprint: string | undefined;
      let stableCount = 0;
      let lastOutput = '';
      let outcome: Outcome = 'timeout';

      const initialSleep = firstSleepMs(baseInterval, prior, maxWaitMs);
      if (initialSleep > 0 && !(await abortableSleep(initialSleep, signal))) {
        outcome = 'aborted';
      }

      while (outcome === 'timeout' && Date.now() < deadline) {
        attempts += 1;

        const probe = await runCommand('sh', ['-c', params.command], {
          cwd,
          timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(1000, deadline - Date.now())),
          signal,
        });
        const combined = `${probe.stdout}\n${probe.stderr}`.trim();
        lastOutput = combined;

        // ── 1. Failure first: never wait out a known failure ──
        if (failureRe instanceof RegExp && failureRe.test(combined)) {
          outcome = 'failure_regex';
          break;
        }

        // ── 2. Explicit success ──
        if (successRe instanceof RegExp && successRe.test(combined)) {
          outcome = 'success_regex';
          break;
        }

        // ── 3. Probe exit code ──
        if (params.expectExitCode !== undefined && probe.code === params.expectExitCode) {
          outcome = 'exit_code';
          break;
        }

        // ── 4. Stability heuristic (opt-in, last) ──
        if (wantsStability) {
          const fingerprint = outputFingerprint(combined);
          stableCount = fingerprint === lastFingerprint ? stableCount + 1 : 0;
          lastFingerprint = fingerprint;
          if (stableCount + 1 >= requiredStable) {
            outcome = 'stable_output';
            break;
          }
        }

        onUpdate?.({
          content: [
            {
              type: 'text',
              text:
                `⏳ poll ${attempts} after ${formatDuration(Date.now() - startedAt)}` +
                `${wantsStability ? ` (stable ${stableCount + 1}/${requiredStable})` : ''}\n` +
                displayTail(combined, 5),
            },
          ],
          details: { attempts, elapsedMs: Date.now() - startedAt },
        });

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          break;
        }
        if (!(await abortableSleep(Math.min(interval, remaining), signal))) {
          outcome = 'aborted';
          break;
        }
        interval = nextIntervalMs(interval, deadline - Date.now());
      }

      const elapsedMs = Date.now() - startedAt;

      // Teach the cache only on a clean, explicit success — a timeout or a
      // heuristic verdict is not evidence of how long this normally takes.
      if (outcome === 'success_regex' || outcome === 'exit_code') {
        recordDuration(`poll:${params.command}`, elapsedMs, { cwd });
      }

      const failed = _isFailure(outcome);
      const tail = displayTail(lastOutput, params.tailLines ?? DEFAULT_TAIL_LINES);

      return {
        content: [
          {
            type: 'text',
            text:
              `${OUTCOME_TEXT[outcome]} after ${formatDuration(elapsedMs)} ` +
              `(${attempts} probe${attempts === 1 ? '' : 's'}).\n\n` +
              `${tail || '(no output)'}`,
          },
        ],
        ...(failed ? { isError: true } : {}),
        details: { outcome, attempts, elapsedMs, lastOutput: lastOutput.slice(0, 2000) },
      };
    },
  });
}
