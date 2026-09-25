// scripts/src/lib/agents/subagents/supervise.ts
//
// The supervisor: one process per subagent round. It runs `pi --mode json`
// as a CHILD (so completion is the exact exit code, never a scraped pane
// status), streams a readable log to its own stdout (the herdr tab), folds
// events into state.json, and — for write agents — publishes the PR and runs
// the CodeRabbit loop after pi exits.
//
// 🔴 Why JSON mode and not an interactive TUI in the pane: the contract
// pipeline learned the hard way that PTY keystroke injection and agent-status
// scraping are unreliable. A child process with a pipe is not.

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { publishWorktree } from '../../herdr/worktree.ts';
import { runGit } from '../git_worktree.ts';
import { parseLine, reduceEvent, type StreamState } from './events.ts';
import { splitTitle } from './prompt.ts';
import { publishRun } from './publish.ts';
import {
  listSteeringMessages,
  patchState,
  readSpec,
  readState,
  readText,
  removeSteeringMessage,
  runFile,
  updateState,
  writeText,
} from './store.ts';
import type { SubagentSpec, SubagentState } from './types.ts';

const STATE_FLUSH_MS = 2_000;
const SUMMARY_CHARS = 400;

/** Tools no subagent gets by default: recursion, pane control, releases. */
const ALWAYS_EXCLUDED = ['subagent', 'herdr', 'gh_workflow', 'gh_release', 'task_pr', 'contract'];
/** Extra exclusions for read agents: anything that mutates files or GitHub. */
const READ_EXCLUDED = [
  'edit',
  'write',
  'edit_lines',
  'gh_pr',
  'gh_issue',
  'code_rabbit',
  'herdr_session',
];
/** Write agents never open PRs themselves — the supervisor does. */
const WRITE_EXCLUDED = ['gh_pr', 'code_rabbit', 'herdr_session'];

export const buildPiArgs = (options: {
  spec: SubagentSpec;
  sessionId: string;
  task: string;
}): string[] => {
  const { spec } = options;
  const args = ['--mode', 'json', '--approve', '--model', spec.model];
  if (spec.thinking) {
    args.push('--thinking', spec.thinking);
  }
  // `--session-id` creates the session on round 1 and resumes it on follow-ups.
  args.push('--session-id', options.sessionId);
  args.push('--append-system-prompt', runFile(spec.repoRoot, spec.id, 'prompt.md'));
  if (spec.noSkillDiscovery) {
    args.push('--no-skills');
  }
  const excluded = new Set([
    ...ALWAYS_EXCLUDED,
    ...(spec.kind === 'read' ? READ_EXCLUDED : WRITE_EXCLUDED),
    ...spec.excludeTools,
  ]);
  const tools = spec.tools
    ?.flatMap((tool) => tool.split(',').map((name) => name.trim()))
    .filter(Boolean);
  if (tools && tools.length > 0) {
    const forbidden = tools.find((tool) => excluded.has(tool));
    if (forbidden) {
      throw new Error(`Tool "${forbidden}" is excluded for ${spec.kind} subagents`);
    }
    args.push('--tools', tools.join(','));
  } else {
    args.push('--exclude-tools', [...excluded].join(','));
  }
  args.push('-p', options.task);
  return args;
};

const porcelain = (cwd: string): Set<string> => {
  try {
    return new Set(runGit('status --porcelain', { cwd }).split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
};

/**
 * Mirror lifecycle into herdr's sidebar (working/idle + message) so a human
 * scanning workspaces sees subagent progress. Fire-and-forget, best effort.
 */
const reportPane = (
  paneId: string | undefined,
  state: 'working' | 'idle',
  message?: string,
): void => {
  if (!paneId) {
    return;
  }
  const args = [
    'pane',
    'report-agent',
    '--source',
    'aikami-subagent',
    '--agent',
    'pi',
    '--state',
    state,
  ];
  if (message) {
    args.push('--message', message.slice(0, 120));
  }
  try {
    spawn('herdr', [...args, paneId], { stdio: 'ignore' })
      .on('error', () => undefined)
      .unref();
  } catch {
    // herdr absent — nothing to mirror into.
  }
};

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const runPi = (options: {
  spec: SubagentSpec;
  state: SubagentState;
  cwd: string;
  task: string;
}): Promise<{ code: number | null; stream: StreamState; timedOut: boolean }> => {
  const { spec } = options;
  const sessionId = options.state.piSessionId ?? crypto.randomUUID();
  const args = buildPiArgs({ spec, sessionId, task: options.task });
  const eventsPath = runFile(spec.repoRoot, spec.id, 'events.jsonl');

  const child = spawn('pi', args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SUBAGENT_ID: spec.id,
      SUBAGENT_DEPTH: String(Number(process.env.SUBAGENT_DEPTH ?? '0') + 1),
      HERDR_DISABLE_SOUND: '1',
    },
  });
  const started = updateState(spec.repoRoot, spec.id, (current) =>
    current.status === 'killed'
      ? current
      : { ...current, piPid: child.pid, piSessionId: sessionId, status: 'running' },
  );
  if (started.status === 'killed') {
    child.kill('SIGTERM');
  }

  let stream: StreamState = { usage: options.state.usage, lastText: '' };
  let dirty = false;
  const flush = (): void => {
    if (dirty) {
      dirty = false;
      patchState(spec.repoRoot, spec.id, { usage: stream.usage, activity: stream.activity });
      reportPane(options.state.paneId, 'working', stream.activity);
    }
  };
  const flusher = setInterval(flush, STATE_FLUSH_MS);

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (text: string) => {
    appendFileSync(eventsPath, text);
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const { state: next, log } = reduceEvent(stream, parseLine(line));
      stream = next;
      dirty = true;
      if (log) {
        print(log);
      }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    if (!/No models match pattern/.test(text)) {
      process.stderr.write(text);
    }
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
  }, spec.timeoutMs);

  // Forward a kill of the supervisor to pi, then let the exit handler record it.
  const forward = (): void => {
    child.kill('SIGTERM');
  };
  process.once('SIGTERM', forward);
  process.once('SIGINT', forward);

  return new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(flusher);
      process.removeListener('SIGTERM', forward);
      process.removeListener('SIGINT', forward);
      if (buffer) {
        stream = reduceEvent(stream, parseLine(buffer)).state;
      }
      flush();
      resolve({ code, stream, timedOut });
    });
  });
};

const finish = (spec: SubagentSpec, patch: Partial<SubagentState>): SubagentState => {
  const next = updateState(spec.repoRoot, spec.id, (current) => ({
    ...current,
    ...patch,
    status: current.status === 'killed' ? 'killed' : (patch.status ?? current.status),
    error: current.status === 'killed' ? current.error : patch.error,
    finishedAt: new Date().toISOString(),
  }));
  reportPane(next.paneId, 'idle', `${next.status}${next.error ? `: ${next.error}` : ''}`);
  return next;
};

type PiOutcome = Awaited<ReturnType<typeof runPi>>;

/** Failure reason for a finished pi run, or undefined when it succeeded. */
const failureOf = (spec: SubagentSpec, outcome: PiOutcome): string | undefined => {
  if (outcome.timedOut) {
    return `timed out after ${Math.round(spec.timeoutMs / 60_000)} min`;
  }
  if (outcome.stream.errored) {
    return outcome.stream.errored;
  }
  if (outcome.code !== 0) {
    return `pi exited with code ${outcome.code}`;
  }
  return outcome.stream.lastText ? undefined : 'no final answer';
};

/** Publish a write agent's work; returns an error message on failure. */
const publishIfWanted = async (
  spec: SubagentSpec,
  checkoutPath: string | undefined,
  result: string,
): Promise<string | undefined> => {
  if (spec.kind !== 'write' || !checkoutPath) {
    return undefined;
  }
  try {
    const existingPr = readState(spec.repoRoot, spec.id)?.pr;
    if (existingPr) {
      const title = spec.pr.title ?? splitTitle(result).title ?? `chore: ${spec.name}`;
      patchState(spec.repoRoot, spec.id, { status: 'publishing', activity: 'updating PR branch' });
      const { headBranch, headCommit } = await publishWorktree({
        checkoutPath,
        repoRoot: spec.repoRoot,
        base: spec.pr.base,
        message: title,
        authorName: 'Pi Subagent',
        authorEmail: 'agent@pi.internal',
      });
      if (headBranch !== readState(spec.repoRoot, spec.id)?.branch) {
        throw new Error(`published branch ${headBranch} differs from the existing PR branch`);
      }
      patchState(spec.repoRoot, spec.id, {
        pr: { ...existingPr, headCommit },
        activity: `PR #${existingPr.number} branch updated`,
      });
      return undefined;
    }
    if (!spec.pr.enabled) {
      return undefined;
    }
    await publishRun({
      spec,
      checkoutPath,
      result,
      report: (line) => {
        print(`  ◆ ${line}`);
        patchState(spec.repoRoot, spec.id, { activity: line });
      },
    });
    return undefined;
  } catch (error) {
    return `publish failed: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const begin = (spec: SubagentSpec, cwd: string, task: string): boolean => {
  const state = updateState(spec.repoRoot, spec.id, (current) =>
    current.status === 'killed'
      ? current
      : {
          ...current,
          supervisorPid: process.pid,
          status: 'starting',
          startedAt: current.startedAt ?? new Date().toISOString(),
          finishedAt: undefined,
          error: undefined,
        },
  );
  if (state.status === 'killed') {
    return false;
  }
  print(`━━ subagent ${spec.id} (${spec.kind}) ━━`);
  print(`model ${spec.model}${spec.thinking ? `:${spec.thinking}` : ''} · cwd ${cwd}`);
  print(`task: ${task.split('\n')[0]?.slice(0, 160) ?? ''}\n`);
  return true;
};

const buildSteeringTask = (options: {
  previousResult: string;
  messages: NonNullable<ReturnType<typeof listSteeringMessages>>;
}): string =>
  [
    'The captain queued steering while your previous turn was running.',
    '',
    'Previous turn result:',
    options.previousResult || '(no final text)',
    '',
    'Queued steering:',
    ...options.messages.map((message, index) => `${index + 1}. ${message.text}`),
    '',
    'Apply the steering in the same worktree and session. End with the final answer described in your brief.',
  ].join('\n');

type RoundContext = {
  spec: SubagentSpec;
  state: SubagentState;
  cwd: string;
  task: string;
  result: string;
  rounds: number;
  deliveredMessageIds: string[];
};

type RoundBoundary =
  | { kind: 'failed' }
  | { kind: 'continue'; context: RoundContext }
  | { kind: 'complete'; state: SubagentState; outcome: PiOutcome; result: string; rounds: number };

const removeDeliveredSteering = (options: {
  repoRoot: string;
  id: string;
  messageIds: readonly string[];
}): void => {
  for (const messageId of options.messageIds) {
    removeSteeringMessage({ repoRoot: options.repoRoot, id: options.id, messageId });
  }
};

const claimCompletion = (spec: SubagentSpec): SubagentState =>
  updateState(spec.repoRoot, spec.id, (current) => {
    const pending = listSteeringMessages(spec.repoRoot, spec.id);
    if (pending.length > 0 || current.status === 'killed') {
      return current;
    }
    return {
      ...current,
      status: spec.kind === 'write' ? 'publishing' : 'succeeded',
      activity: 'finalizing',
      queuedMessages: 0,
    };
  });

const runRound = async (context: RoundContext): Promise<RoundBoundary> => {
  const outcome = await runPi({
    spec: context.spec,
    state: context.state,
    cwd: context.cwd,
    task: context.task,
  });
  const result = outcome.stream.lastText || '(the subagent produced no final text)';
  const state = readState(context.spec.repoRoot, context.spec.id) ?? context.state;
  const rounds = context.rounds + 1;

  if (state.status === 'killed') {
    print('\n🛑 killed');
    finish(context.spec, {});
    return { kind: 'failed' };
  }
  const roundError = failureOf(context.spec, outcome);
  if (roundError) {
    print(`\n❌ ${roundError}`);
    finish(context.spec, { status: 'failed', error: roundError });
    return { kind: 'failed' };
  }

  removeDeliveredSteering({
    repoRoot: context.spec.repoRoot,
    id: context.spec.id,
    messageIds: context.deliveredMessageIds,
  });
  const queued = listSteeringMessages(context.spec.repoRoot, context.spec.id);
  if (queued.length > 0) {
    const task = buildSteeringTask({ previousResult: result, messages: queued });
    writeText(runFile(context.spec.repoRoot, context.spec.id, 'task.md'), `${task}\n`);
    patchState(context.spec.repoRoot, context.spec.id, {
      status: 'running',
      activity: `delivering ${queued.length} queued message(s)`,
      queuedMessages: queued.length,
    });
    return {
      kind: 'continue',
      context: {
        ...context,
        state,
        task,
        result,
        rounds,
        deliveredMessageIds: queued.map((message) => message.id),
      },
    };
  }

  const claimed = claimCompletion(context.spec);
  if (claimed.status === 'killed') {
    print('\n🛑 killed');
    finish(context.spec, {});
    return { kind: 'failed' };
  }
  if (listSteeringMessages(context.spec.repoRoot, context.spec.id).length > 0) {
    return {
      kind: 'continue',
      context: { ...context, state: claimed, result, rounds, deliveredMessageIds: [] },
    };
  }
  return { kind: 'complete', state: claimed, outcome, result, rounds };
};

const finishSupervision = async (options: {
  spec: SubagentSpec;
  initial: SubagentState;
  before: Set<string> | undefined;
  boundary: Extract<RoundBoundary, { kind: 'complete' }>;
}): Promise<number> => {
  const { spec, initial, before, boundary } = options;
  writeText(runFile(spec.repoRoot, spec.id, 'result.md'), `${boundary.result}\n`);
  const base: Partial<SubagentState> = {
    exitCode: boundary.outcome.code,
    summary: boundary.result.slice(0, SUMMARY_CHARS),
    strayWrites: before
      ? [...porcelain(spec.repoRoot)].filter((line) => !before.has(line))
      : undefined,
  };
  const after = updateState(spec.repoRoot, spec.id, (current) => ({
    ...current,
    ...base,
    rounds: current.rounds + boundary.rounds,
  }));
  if (after.status === 'killed') {
    print('\n🛑 killed');
    finish(spec, {});
    return 1;
  }
  const error =
    failureOf(spec, boundary.outcome) ??
    (await publishIfWanted(spec, initial.checkoutPath, boundary.result));
  if (error) {
    print(`\n❌ ${error}`);
    finish(spec, { status: 'failed', error });
    return 1;
  }
  const finished = finish(spec, { status: 'succeeded' });
  if (finished.status === 'killed') {
    print('\n🛑 killed');
    return 1;
  }
  print(
    `\n✅ done · ${boundary.outcome.stream.usage.turns} turns · $${boundary.outcome.stream.usage.cost.toFixed(4)}`,
  );
  return 0;
};

export const supervise = async (options: { repoRoot: string; id: string }): Promise<number> => {
  const spec = readSpec(options.repoRoot, options.id);
  const initial = readState(options.repoRoot, options.id);
  if (!spec || !initial) {
    print(`❌ Unknown subagent ${options.id}`);
    return 1;
  }
  const cwd = initial.checkoutPath ?? spec.repoRoot;
  const task = readText(runFile(spec.repoRoot, spec.id, 'task.md')) ?? spec.task;
  if (!begin(spec, cwd, task)) {
    return 1;
  }

  const before = spec.kind === 'read' ? porcelain(spec.repoRoot) : undefined;
  let context: RoundContext = {
    spec,
    state: initial,
    cwd,
    task,
    result: '',
    rounds: 0,
    deliveredMessageIds: [],
  };

  // JSON mode is intentionally one prompt per process. A message accepted
  // while Pi is running is therefore handled at the next safe boundary, using
  // the persisted session id and the same checkout. This is queued steering,
  // not a claim that an in-flight model/tool call can be interrupted.
  for (;;) {
    const boundary = await runRound(context);
    if (boundary.kind === 'failed') {
      return 1;
    }
    if (boundary.kind === 'complete') {
      return finishSupervision({ spec, initial, before, boundary });
    }
    context = boundary.context;
  }
};
