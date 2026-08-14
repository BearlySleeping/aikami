// .pi/extensions/background_tasks.ts
//
// Background command execution — start a long command, keep working, collect
// the result later.
//
// 🔴 Why this is NOT a polling tool:
//
// For any command you launch yourself, the completion signal is the EXIT
// CODE. It is exact, it is free, and it arrives the instant the process ends.
// Guessing completion from "the output stopped changing" is strictly worse
// and fails both ways on real builds — rustc emits nothing for minutes during
// linking (false "done"), while cargo's progress bar redraws forever (never
// "done"). See poll_until.ts for the cases where there genuinely is no exit
// event to wait on.
//
// pi's built-in bash tool has no background mode, so a 6-minute build blocks
// the whole turn. Here `bg run` returns an id immediately, `bg wait` blocks
// with live progress streamed via onUpdate, and `bg status` is a cheap peek.
//
// Observed durations feed the shared duration cache, so repeat runs report a
// real ETA instead of an unbounded spinner.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatDuration } from './lib/async.ts';
import { getDurationPrior, recordDuration } from './lib/duration_cache.ts';
import { displayTail } from './lib/output_normalize.ts';
import { type CommandHandle, startCommand } from './lib/process_runner.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

// ── Tuning ─────────────────────────────────────────────────────────

/** Hard ceiling on a background command. 30 min covers a cold Rust build. */
const MAX_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Output lines returned by default. Enough to see a build's tail or a stack trace. */
const DEFAULT_TAIL_LINES = 40;

/** How often `wait` pushes a progress update to the UI. */
const PROGRESS_INTERVAL_MS = 2000;

/** Completed tasks retained for later inspection before the oldest are dropped. */
const MAX_RETAINED_TASKS = 50;

// ── Task registry ──────────────────────────────────────────────────

type Task = {
  id: string;
  command: string;
  cwd: string;
  handle: CommandHandle;
  startedAt: number;
  /** Set once the process exits. */
  finishedAt?: number;
  exitCode?: number | null;
  killed?: boolean;
  /** Learned prior at launch time, used for the ETA. */
  expectedMs?: number;
};

const tasks = new Map<string, Task>();
let taskCounter = 0;

/** Drops the oldest finished tasks once the registry grows past its cap. */
const _evictOldTasks = (): void => {
  if (tasks.size <= MAX_RETAINED_TASKS) {
    return;
  }
  const finished = [...tasks.values()]
    .filter((t) => !t.handle.running())
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));

  for (const task of finished.slice(0, tasks.size - MAX_RETAINED_TASKS)) {
    tasks.delete(task.id);
  }
};

// ── Formatting ─────────────────────────────────────────────────────

const _elapsed = (task: Task): number => (task.finishedAt ?? Date.now()) - task.startedAt;

type TaskState = 'running' | 'success' | 'failed' | 'killed';

const _state = (task: Task): TaskState => {
  if (task.handle.running()) {
    return 'running';
  }
  if (task.killed) {
    return 'killed';
  }
  return task.exitCode === 0 ? 'success' : 'failed';
};

const STATE_ICON: Record<TaskState, string> = {
  running: '⏳',
  success: '✅',
  failed: '❌',
  killed: '🛑',
};

/** One-line status header shared by run/status/wait/list. */
const _headline = (task: Task): string => {
  const state = _state(task);
  const elapsed = formatDuration(_elapsed(task));

  if (state === 'running') {
    const eta = task.expectedMs ? `, expected ~${formatDuration(task.expectedMs)}` : '';
    return `${STATE_ICON[state]} ${task.id} running for ${elapsed}${eta} — ${task.command}`;
  }

  const code = task.killed ? 'killed' : `exit ${task.exitCode}`;
  return `${STATE_ICON[state]} ${task.id} ${code} after ${elapsed} — ${task.command}`;
};

const _details = (task: Task) => ({
  id: task.id,
  command: task.command,
  state: _state(task),
  exitCode: task.exitCode ?? null,
  elapsedMs: _elapsed(task),
  running: task.handle.running(),
});

// ── Launch ─────────────────────────────────────────────────────────

const _launch = (command: string, cwd: string, timeoutMs: number): Task => {
  taskCounter += 1;
  const id = `bg${taskCounter}`;
  const prior = getDurationPrior(command, { cwd });

  // `sh -c` so the model can pass a natural command line with pipes and &&.
  // The child still gets its own process group, so kill() reaps the whole tree.
  const handle = startCommand('sh', ['-c', command], { cwd, timeoutMs });

  const task: Task = {
    id,
    command,
    cwd,
    handle,
    startedAt: Date.now(),
    expectedMs: prior?.expectedMs,
  };
  tasks.set(id, task);

  void handle.completion.then((result) => {
    task.finishedAt = Date.now();
    task.exitCode = result.code;
    task.killed = result.killed;

    // Only successful runs teach the cache — a build that failed in 3s must
    // not convince us the next one will also take 3s.
    if (result.code === 0 && !result.killed) {
      recordDuration(command, result.durationMs, { cwd });
    }
    _evictOldTasks();
  });

  return task;
};

// ── Extension ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const resolveCwd = (cwd?: string): string => cwd ?? process.cwd();

  const requireTask = (id: string): Task | undefined => tasks.get(id);

  const missingTask = (id: string) => ({
    content: [
      {
        type: 'text' as const,
        text:
          `❌ No background task "${id}". Known ids: ` +
          `${[...tasks.keys()].join(', ') || '(none)'}`,
      },
    ],
    isError: true,
    details: { error: 'unknown_task', id },
  });

  registerNamespace(pi, {
    name: 'bg',
    label: 'Background Task',
    description:
      'Run long shell commands in the background and collect their results by exit code. ' +
      'Use this instead of bash for builds, test suites, deploys and dev servers — ' +
      'bash blocks the whole turn, and completion here is the exact exit code, never a guess.',
    promptSnippet:
      'Use bg to run long commands (builds, test suites, deploys) without blocking the turn',
    actions: [
      // ── run ────────────────────────────────────────────────────
      defineAction({
        action: 'run',
        summary:
          'Start a command in the background. Returns an id immediately; set waitMs to block for a short run',
        parameters: Type.Object({
          command: Type.String({
            description: 'Shell command line, e.g. "bun moon run app:build"',
          }),
          cwd: Type.Optional(
            Type.String({ description: 'Working directory (default: repo root)' }),
          ),
          timeoutMs: Type.Optional(
            Type.Number({
              default: DEFAULT_TIMEOUT_MS,
              description: `Kill the command after this long (max ${MAX_TIMEOUT_MS})`,
            }),
          ),
          waitMs: Type.Optional(
            Type.Number({
              default: 0,
              description:
                'Block up to this long for completion before returning. 0 returns immediately.',
            }),
          ),
          tailLines: Type.Optional(Type.Number({ default: DEFAULT_TAIL_LINES })),
        }),
        async execute(_toolCallId, params, signal, onUpdate) {
          const timeoutMs = Math.min(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
          const tailLines = params.tailLines ?? DEFAULT_TAIL_LINES;
          const task = _launch(params.command, resolveCwd(params.cwd), timeoutMs);

          const waitMs = params.waitMs ?? 0;
          if (waitMs <= 0) {
            const eta = task.expectedMs
              ? ` Expected ~${formatDuration(task.expectedMs)} based on previous runs.`
              : '';
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `⏳ Started ${task.id}: ${task.command}${eta}\n` +
                    `Collect it with bg.wait {id:"${task.id}"} or peek with bg.status.`,
                },
              ],
              details: _details(task),
            };
          }

          const finished = await _await(task, waitMs, signal, onUpdate, tailLines);
          return finished;
        },
      }),

      // ── wait ───────────────────────────────────────────────────
      defineAction({
        action: 'wait',
        summary: 'Block until a background task exits, streaming progress',
        parameters: Type.Object({
          id: Type.String({ description: 'Task id from bg.run, e.g. "bg1"' }),
          timeoutMs: Type.Optional(
            Type.Number({
              default: DEFAULT_TIMEOUT_MS,
              description: 'Give up waiting after this long',
            }),
          ),
          tailLines: Type.Optional(Type.Number({ default: DEFAULT_TAIL_LINES })),
        }),
        async execute(_toolCallId, params, signal, onUpdate) {
          const task = requireTask(params.id);
          if (!task) {
            return missingTask(params.id);
          }
          return _await(
            task,
            Math.min(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
            signal,
            onUpdate,
            params.tailLines ?? DEFAULT_TAIL_LINES,
          );
        },
      }),

      // ── status ─────────────────────────────────────────────────
      defineAction({
        action: 'status',
        summary: 'Cheap snapshot of one task without waiting',
        parameters: Type.Object({
          id: Type.String(),
          tailLines: Type.Optional(Type.Number({ default: 20 })),
        }),
        async execute(_toolCallId, params) {
          const task = requireTask(params.id);
          if (!task) {
            return missingTask(params.id);
          }
          const tail = displayTail(task.handle.output(), params.tailLines ?? 20);
          return {
            content: [{ type: 'text', text: `${_headline(task)}${tail ? `\n\n${tail}` : ''}` }],
            details: _details(task),
          };
        },
      }),

      // ── list ───────────────────────────────────────────────────
      defineAction({
        action: 'list',
        summary: 'List every background task in this session',
        parameters: Type.Object({}),
        async execute() {
          if (tasks.size === 0) {
            return {
              content: [{ type: 'text', text: 'No background tasks in this session.' }],
              details: { tasks: [] },
            };
          }
          const lines = [...tasks.values()].map(_headline);
          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { tasks: [...tasks.values()].map(_details) },
          };
        },
      }),

      // ── kill ───────────────────────────────────────────────────
      defineAction({
        action: 'kill',
        summary: 'Terminate a running task (SIGTERM, then SIGKILL)',
        parameters: Type.Object({
          id: Type.String(),
          force: Type.Optional(
            Type.Boolean({ default: false, description: 'SIGKILL immediately' }),
          ),
        }),
        async execute(_toolCallId, params) {
          const task = requireTask(params.id);
          if (!task) {
            return missingTask(params.id);
          }
          if (!task.handle.running()) {
            return {
              content: [{ type: 'text', text: `${task.id} already finished.\n${_headline(task)}` }],
              details: _details(task),
            };
          }
          task.handle.kill(params.force ?? false);
          await task.handle.completion;
          return {
            content: [{ type: 'text', text: `🛑 Killed ${task.id}.` }],
            details: _details(task),
          };
        },
      }),
    ],
  });
}

// ── Waiting with live progress ─────────────────────────────────────

type ToolResult = {
  content: { type: 'text'; text: string }[];
  details: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Waits for a task, pushing periodic progress through onUpdate so the user
 * sees movement instead of a silent turn. Returns a normal tool result on
 * exit, or a "still running" result if the wait budget runs out first —
 * the task keeps running either way and can be collected later.
 */
const _await = async (
  task: Task,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: ToolResult) => void) | undefined,
  tailLines: number,
): Promise<ToolResult> => {
  const progress = onUpdate
    ? setInterval(() => {
        onUpdate({
          content: [
            {
              type: 'text',
              text: `${_headline(task)}\n\n${displayTail(task.handle.output(), 8)}`,
            },
          ],
          details: _details(task),
        });
      }, PROGRESS_INTERVAL_MS)
    : undefined;

  // Race the process against the wait budget. A timeout here abandons the
  // WAIT, not the task — bg.wait can be called again.
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const cancelled = new Promise<'aborted'>((resolve) => {
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      resolve('aborted');
      return;
    }
    signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });

  const outcome = await Promise.race([
    task.handle.completion.then(() => 'done' as const),
    budget,
    cancelled,
  ]);

  clearInterval(progress);
  clearTimeout(timer);

  const tail = displayTail(task.handle.output(), tailLines);

  if (outcome !== 'done') {
    const reason =
      outcome === 'aborted'
        ? 'Wait cancelled'
        : `Stopped waiting after ${formatDuration(timeoutMs)}`;
    return {
      content: [
        {
          type: 'text',
          text:
            `⏳ ${reason} — ${task.id} is STILL RUNNING (not killed).\n` +
            `${_headline(task)}\n\n${tail}\n\n` +
            `Collect it later with bg.wait {id:"${task.id}"}, or stop it with bg.kill.`,
        },
      ],
      details: { ..._details(task), waitOutcome: outcome },
    };
  }

  const state = _state(task);
  const failed = state === 'failed' || state === 'killed';
  return {
    content: [{ type: 'text', text: `${_headline(task)}${tail ? `\n\n${tail}` : ''}` }],
    ...(failed ? { isError: true } : {}),
    details: { ..._details(task), waitOutcome: 'done' },
  };
};
