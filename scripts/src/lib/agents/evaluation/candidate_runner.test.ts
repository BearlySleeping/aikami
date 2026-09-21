// scripts/src/lib/agents/evaluation/candidate_runner.test.ts
//
// The candidate deadline must bound the CANDIDATE, not the platform's cost of
// creating a process.
//
// On a cold Windows CI runner, `node.exe` startup plus real-time AV scanning of
// a module the test wrote milliseconds earlier can take seconds, while macOS and
// Linux boot the same child in ~40ms. Charging that to a 2s candidate budget
// reported "candidate exceeded 2000ms" before the candidate had executed a
// single statement — the frozen acceptance oracle failed on Windows alone for
// an identical semantic task.
//
// These tests drive the arbitration directly, through a fake child, so the
// deadline policy is verified identically on all three operating systems
// instead of depending on how slow the local process spawner happens to be.

import { describe, expect, it } from 'bun:test';
import {
  awaitCandidateOutcome,
  type CandidateChild,
  type CandidateDeadlines,
} from './candidate_runner.ts';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type FakeChild = CandidateChild & {
  emitMessage: (message: unknown) => void;
  emitClose: (code: number | null, signal: string | null) => void;
  emitError: (error: Error) => void;
  wasKilled: () => boolean;
};

/** A child that only does what a test tells it to — no real process involved. */
const createFakeChild = (): FakeChild => {
  let messageHandler: (message: unknown) => void = () => {};
  let closeHandler: (code: number | null, signal: string | null) => void = () => {};
  let errorHandler: (error: Error) => void = () => {};
  let running = true;
  let killed = false;

  const child: FakeChild = {
    onMessage: (handler) => {
      messageHandler = handler;
    },
    onClose: (handler) => {
      closeHandler = handler;
    },
    onError: (handler) => {
      errorHandler = handler;
    },
    // A real SIGKILL is followed by `close`; the arbitration defers settlement
    // to that event, so the fake must emit it too.
    kill: () => {
      killed = true;
      running = false;
      setTimeout(() => closeHandler(null, 'SIGKILL'), 0);
    },
    isRunning: () => running,
    emitMessage: (message) => messageHandler(message),
    emitClose: (code, signal) => {
      running = false;
      closeHandler(code, signal);
    },
    emitError: (error) => {
      running = false;
      errorHandler(error);
    },
    wasKilled: () => killed,
  };
  return child;
};

const started = { type: 'candidate-started' };
const accepted = { type: 'acceptance-result', outcome: { accepted: true, diagnostics: '' } };

const run = (child: FakeChild, deadlines: CandidateDeadlines) =>
  awaitCandidateOutcome(child, { deadlines, readStderr: () => '' });

describe('candidate runner — process startup is not charged to the candidate budget', () => {
  it('accepts a slow-booting child whose candidate then runs well inside the budget', async () => {
    // The startup takes 60ms — twice the candidate budget — before the child
    // reaches its first statement. Under a single spawn-to-exit deadline this
    // is exactly the Windows failure: the candidate is reported as timed out
    // without ever having run.
    const child = createFakeChild();
    const pending = run(child, { startupTimeoutMs: 2_000, candidateTimeoutMs: 30 });
    await delay(60);
    child.emitMessage(started);
    child.emitMessage(accepted);
    expect(await pending).toEqual({ accepted: true, diagnostics: '' });
  });

  it('still bounds the candidate once it has started', async () => {
    const child = createFakeChild();
    const pending = run(child, { startupTimeoutMs: 5_000, candidateTimeoutMs: 30 });
    child.emitMessage(started);
    const outcome = await pending;
    expect(outcome.accepted).toBe(false);
    expect(outcome.diagnostics).toContain('exceeded 30ms');
    expect(child.wasKilled()).toBe(true);
  });

  it('fails closed on the startup deadline when the child never reaches its first statement', async () => {
    const child = createFakeChild();
    const outcome = await run(child, { startupTimeoutMs: 20, candidateTimeoutMs: 5_000 });
    expect(outcome.accepted).toBe(false);
    expect(outcome.diagnostics).toContain('did not reach its first statement within 20ms');
  });

  it('cannot extend its own budget by replaying the readiness message', async () => {
    const child = createFakeChild();
    const pending = run(child, { startupTimeoutMs: 5_000, candidateTimeoutMs: 50 });
    const replay = setInterval(() => child.emitMessage(started), 10);
    const settled = await Promise.race([pending, delay(250).then(() => 'pending' as const)]);
    clearInterval(replay);
    expect(settled).not.toBe('pending');
    expect((settled as { diagnostics: string }).diagnostics).toContain('exceeded 50ms');
  });

  it('reports a spawn failure without waiting for either deadline', async () => {
    const child = createFakeChild();
    const pending = run(child, { startupTimeoutMs: 5_000, candidateTimeoutMs: 5_000 });
    child.emitError(new Error('spawn node ENOENT'));
    const outcome = await pending;
    expect(outcome.accepted).toBe(false);
    expect(outcome.diagnostics).toContain('Candidate subprocess failed: spawn node ENOENT');
  });

  it('reports a child that exits before answering, including its stderr', async () => {
    const child = createFakeChild();
    const pending = awaitCandidateOutcome(child, {
      deadlines: { startupTimeoutMs: 5_000, candidateTimeoutMs: 5_000 },
      readStderr: () => 'Error: ERR_ACCESS_DENIED\n',
    });
    child.emitClose(1, null);
    const outcome = await pending;
    expect(outcome.accepted).toBe(false);
    expect(outcome.diagnostics).toContain('exited before returning a result');
    expect(outcome.diagnostics).toContain('ERR_ACCESS_DENIED');
  });
});
