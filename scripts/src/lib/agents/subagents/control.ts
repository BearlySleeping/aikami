// scripts/src/lib/agents/subagents/control.ts
//
// Lifecycle operations on existing runs: list, kill, follow-up message,
// cleanup, and a blocking wait (for the CLI; the pi extension waits by
// watching state.json directly so it never shells out in a loop).

import { rmSync } from 'node:fs';
import { herdr } from '../../herdr/session.ts';
import { removeWorktree } from '../../herdr/worktree.ts';
import { launchSupervisor, openTab } from './spawn.ts';
import {
  enqueueSteeringMessage,
  isTerminal,
  listRunIds,
  listSteeringMessages,
  patchState,
  pidAlive,
  readLiveState,
  readSpec,
  readText,
  runDir,
  runFile,
  updateState,
  writeText,
} from './store.ts';
import type { SteeringDelivery, SubagentSpec, SubagentState } from './types.ts';

export type RunView = { spec: SubagentSpec; state: SubagentState };

const requireRun = (repoRoot: string, id: string): RunView => {
  const spec = readSpec(repoRoot, id);
  const state = readLiveState(repoRoot, id);
  if (!spec || !state) {
    throw new Error(`No subagent run "${id}". List runs with: bun run subagent list`);
  }
  return { spec, state };
};

export const getRun = requireRun;

export const listRuns = (repoRoot: string, options: { active?: boolean } = {}): RunView[] =>
  listRunIds(repoRoot)
    .map((id) => {
      const spec = readSpec(repoRoot, id);
      const state = readLiveState(repoRoot, id);
      return spec && state ? { spec, state } : undefined;
    })
    .filter((r): r is RunView => r !== undefined)
    .filter((r) => !options.active || !isTerminal(r.state))
    .sort((a, b) => a.spec.createdAt.localeCompare(b.spec.createdAt));

export const readResult = (repoRoot: string, id: string): string | undefined =>
  readText(runFile(repoRoot, id, 'result.md'));

export const killRun = (repoRoot: string, id: string): SubagentState => {
  const { state } = requireRun(repoRoot, id);
  if (isTerminal(state)) {
    return state;
  }
  const next = updateState(repoRoot, id, (current) =>
    isTerminal(current) ? current : { ...current, status: 'killed', error: 'killed by captain' },
  );
  if (next.status !== 'killed') {
    return next;
  }
  for (const pid of [next.piPid, next.supervisorPid]) {
    if (pid && pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Raced with a natural exit.
      }
    }
  }
  return next;
};

/**
 * Queue a captain message for a running subagent, or resume a finished one.
 *
 * The supervised Pi process is one-shot JSON mode, so a running child cannot
 * consume stdin safely. Messages accepted while `queued`/`starting`/`running`
 * are therefore durable and delivered at the next safe process boundary in the
 * same Pi session. The supervisor drains the inbox before publication and before
 * marking the run terminal.
 */
export const messageRun = async (options: {
  repoRoot: string;
  id: string;
  text: string;
  delivery?: SteeringDelivery;
  messageId?: string;
}): Promise<SubagentState> => {
  const { repoRoot, id } = options;
  const { spec, state } = requireRun(repoRoot, id);
  const delivery = options.delivery ?? 'steer';

  if (!isTerminal(state)) {
    if (state.status === 'publishing' || state.status === 'reviewing') {
      throw new Error(
        `${id} has finished computing and is ${state.status}; wait for its terminal state before messaging.`,
      );
    }
    // Serialize the status check + inbox write with the supervisor's completion
    // claim. A message racing final settlement is either queued and drained, or
    // observes publishing/reviewing and receives an accurate refusal.
    const next = updateState(repoRoot, id, (current) => {
      if (current.status === 'publishing' || current.status === 'reviewing') {
        throw new Error(
          `${id} entered ${current.status} while the message was being queued; retry after it settles.`,
        );
      }
      enqueueSteeringMessage({
        repoRoot,
        id,
        text: options.text,
        delivery,
        ...(options.messageId === undefined ? {} : { messageId: options.messageId }),
      });
      const queuedMessages = listSteeringMessages(repoRoot, id).length;
      return {
        ...current,
        queuedMessages,
        activity: `${delivery === 'steer' ? 'steering' : 'follow-up'} queued (${queuedMessages})`,
      };
    });
    return next;
  }

  if (!state.piSessionId) {
    throw new Error(`${id} has no pi session to resume.`);
  }
  writeText(
    runFile(repoRoot, id, 'task.md'),
    `${options.text.trim()}\n\nWhen done, end with the final answer described in your brief.`,
  );
  // The old pane sits on the keep-open trailer ("Press Enter to close"), so a
  // follow-up gets a fresh tab in the same workspace rather than reusing it.
  const placement = state.workspaceId
    ? await openTab({
        workspaceId: state.workspaceId,
        cwd: state.checkoutPath ?? repoRoot,
        label: `${spec.name}#${state.rounds + 1}`,
      }).catch(() => undefined)
    : undefined;
  const next = patchState(repoRoot, id, {
    paneId: placement?.paneId,
    tabId: placement?.tabId ?? state.tabId,
    status: 'queued',
    activity: 'follow-up queued',
    queuedMessages: 0,
    error: undefined,
    finishedAt: undefined,
    supervisorPid: undefined,
    piPid: undefined,
  });
  await launchSupervisor(spec, next);
  return next;
};

export type CleanupOptions = { removeWorktree?: boolean; purge?: boolean; force?: boolean };

export const cleanupRun = async (
  repoRoot: string,
  id: string,
  options: CleanupOptions = {},
): Promise<string[]> => {
  const { spec, state } = requireRun(repoRoot, id);
  if (!isTerminal(state) && !options.force) {
    throw new Error(`${id} is still ${state.status}; kill it first or pass force.`);
  }
  const done: string[] = [];
  const ownsWorktree = spec.kind === 'write' && !spec.reuseCheckout && state.checkoutPath;
  if (ownsWorktree && (options.removeWorktree ?? true)) {
    const r = await removeWorktree({
      workspaceId: state.workspaceId,
      checkoutPath: state.checkoutPath,
      // Keep the branch while its PR is open — the PR needs it.
      branch: state.pr ? undefined : state.branch,
      deleteRemoteBranch: false,
      force: options.force ?? false,
      repoRoot,
    });
    done.push(
      r.removed ? `removed worktree ${state.checkoutPath}` : `worktree kept: ${r.reason ?? '?'}`,
    );
  } else if (state.tabId) {
    await herdr(['tab', 'close', state.tabId]).catch(() => undefined);
    done.push(`closed tab ${state.tabId}`);
  }
  if (options.purge) {
    rmSync(runDir(repoRoot, id), { recursive: true, force: true });
    done.push('purged run record');
  }
  return done;
};

/** Poll until the run is terminal (CLI use). */
export const waitRun = async (
  repoRoot: string,
  id: string,
  timeoutMs: number,
): Promise<SubagentState> => {
  const deadline = Date.now() + timeoutMs;
  let state = requireRun(repoRoot, id).state;
  while (!isTerminal(state) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    state = requireRun(repoRoot, id).state;
  }
  return state;
};
