// .pi/extensions/lib/coderabbit_autofix.test.ts

import { describe, expect, test } from 'bun:test';
import {
  activeAutofixRequest,
  applyCodeRabbitAutofix,
  hasAutofixAttestation,
  isAutofixCommit,
} from './coderabbit_autofix.ts';
import type { ReviewQuery } from './coderabbit_reader.ts';
import {
  formalReviewSnapshot as emptyReviewSnapshot,
  OLD_REVIEW_HEAD,
  REVIEW_HEAD,
  reviewThread,
  runningReviewSnapshot,
} from './testing/coderabbit_fixtures.ts';

const formalReviewSnapshot = () => {
  const snapshot = emptyReviewSnapshot();
  snapshot.threads = [reviewThread()];
  return snapshot;
};

const commit = () => ({
  sha: OLD_REVIEW_HEAD,
  author: { login: 'coderabbitai[bot]' },
  parents: [{ sha: REVIEW_HEAD }],
  commit: {
    verification: {
      verified: true,
      reason: 'valid',
      signature: 'signed',
      payload: 'commit payload',
    },
  },
});
const attestedSnapshot = () => {
  const snapshot = { ...formalReviewSnapshot(), head: OLD_REVIEW_HEAD };
  snapshot.comments.push({
    id: 'attestation',
    login: 'coderabbitai[bot]',
    body: `Autofix applied: https://github.com/base/repo/commit/${OLD_REVIEW_HEAD}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return snapshot;
};
const request = () => ({
  id: 'request',
  login: 'human',
  body: '@coderabbitai autofix',
  createdAt: new Date(Date.now() - 1000).toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('autofix request and commit provenance', () => {
  test('signed direct-child bot attribution, never unsigned or unrelated Git metadata', () => {
    expect(isAutofixCommit({ value: commit(), baseline: REVIEW_HEAD, head: OLD_REVIEW_HEAD })).toBe(
      true,
    );
    for (const value of [
      { ...commit(), author: { login: 'human' } },
      { ...commit(), author: { login: 'coderabbitai-impersonator' } },
      { ...commit(), parents: [{ sha: 'different-head' }] },
      { ...commit(), parents: [] },
      { ...commit(), sha: 'wrong-head' },
      { ...commit(), commit: { verification: { verified: false, reason: 'unsigned' } } },
      { ...commit(), commit: undefined },
      undefined,
    ]) {
      expect(isAutofixCommit({ value, baseline: REVIEW_HEAD, head: OLD_REVIEW_HEAD })).toBe(false);
    }
  });
  test('historical unresolved threads are merge blockers, not automatic autofix targets', async () => {
    const snapshot = formalReviewSnapshot();
    snapshot.threads = [{ ...reviewThread(), head: OLD_REVIEW_HEAD }];
    let commands = 0;
    const result = await applyCodeRabbitAutofix({
      initial: snapshot,
      readSnapshot: async () => snapshot,
      report: () => {},
      query: async () => {
        commands++;
        return { success: true, text: '' };
      },
    });
    expect(result.status).toBe('no-current-findings');
    expect(commands).toBe(0);
  });
  test('intervening human comments do not cause duplicate commands', () => {
    const snapshot = formalReviewSnapshot();
    const review = snapshot.reviews[0];
    if (review) {
      review.submittedAt = new Date(Date.now() - 5000).toISOString();
    }
    snapshot.comments.push(request(), { ...request(), id: 'chatter', body: 'Hello' });
    expect(activeAutofixRequest(snapshot)).toBeDefined();
  });
  test('old request and old applied replies do not satisfy a fresh cycle', () => {
    const snapshot = formalReviewSnapshot();
    snapshot.comments.push({ ...request(), createdAt: '2026-10-05T02:00:00Z' });
    expect(activeAutofixRequest(snapshot)).toBeUndefined();
  });
  test('a bot error containing a run ID is failure, not applied', async () => {
    const initial = formalReviewSnapshot();
    let reads = 0;
    const result = await applyCodeRabbitAutofix({
      initial,
      report: () => {},
      intervalMs: 1,
      timeoutMs: 100,
      readSnapshot: async () => {
        const snapshot = formalReviewSnapshot();
        if (++reads > 1) {
          snapshot.comments.push({
            ...request(),
            id: 'error',
            login: 'coderabbitai[bot]',
            body: 'autofix-run-id:123 unexpected error; Fixes Applied',
          });
          const reply = snapshot.comments.at(-1);
          if (reply) {
            reply.createdAt = new Date().toISOString();
          }
        }
        return snapshot;
      },
      query: async () => ({ success: true, text: '' }),
    });
    expect(result.status).toBe('failed');
    expect(result.commit).toBeUndefined();
  });
  test.each([
    { timestamps: ['2020-01-01T00:00:02Z', 'invalid', '2020-01-01T00:00:01Z'] },
    { timestamps: [] },
    { timestamps: ['invalid'] },
  ])('fresh replies use the GitHub clock with baseline timestamps %j', async ({ timestamps }) => {
    const initial = formalReviewSnapshot();
    initial.comments = timestamps.map((createdAt, index) => ({
      ...request(),
      id: `existing-${index}`,
      login: 'coderabbitai[bot]',
      body: 'Autofix skipped',
      createdAt,
    }));
    let reads = 0;
    const result = await applyCodeRabbitAutofix({
      initial,
      report: () => {},
      timeoutMs: 1000,
      intervalMs: 1,
      readSnapshot: async () => {
        const snapshot = { ...initial, comments: [...initial.comments] };
        if (++reads === 2) {
          snapshot.comments.push({
            ...request(),
            id: 'older-unseen',
            login: 'coderabbitai[bot]',
            body: 'Autofix skipped',
            createdAt: '2019-12-31T23:59:59Z',
          });
          // Only the populated baseline can reject an unseen older reply.
          if (timestamps.some((timestamp) => Number.isFinite(Date.parse(timestamp)))) {
            return snapshot;
          }
          snapshot.comments.pop();
        }
        if (reads > 1) {
          snapshot.comments.push({
            ...request(),
            id: 'fresh',
            login: 'coderabbitai[bot]',
            body: 'No autofix changes were needed',
            createdAt: '2020-01-01T00:00:02Z',
          });
        }
        return snapshot;
      },
      query: async () => ({ success: true, text: '' }),
    });
    expect(result.status).toBe('no-change');
  });
  test('transient snapshot failures recover to a verified autofix', async () => {
    let reads = 0;
    const reports: string[] = [];
    const result = await applyCodeRabbitAutofix({
      initial: formalReviewSnapshot(),
      report: (line) => reports.push(line),
      timeoutMs: 1000,
      intervalMs: 1,
      readSnapshot: async () => {
        reads++;
        if (reads === 2) {
          throw new Error('HTTP 503');
        }
        return reads === 1 ? formalReviewSnapshot() : attestedSnapshot();
      },
      query: async (args) => ({
        success: true,
        text: '',
        json: args[0] === 'api' ? commit() : undefined,
      }),
    });
    expect(result.status).toBe('committed');
    expect(reports.some((line) => line.includes('HTTP 503'))).toBe(true);
  });
  test('persistent read failures respect the deadline even with a longer interval', async () => {
    let reads = 0;
    const result = await applyCodeRabbitAutofix({
      initial: formalReviewSnapshot(),
      report: () => {},
      timeoutMs: 20,
      intervalMs: 60_000,
      readSnapshot: async () => {
        if (++reads > 1) {
          throw new Error('HTTP 503');
        }
        return formalReviewSnapshot();
      },
      query: async () => ({ success: true, text: '' }),
    });
    expect(result.status).toBe('timeout');
    expect(reads).toBe(2);
  });
  test('aborting a failed snapshot read propagates without retrying', async () => {
    const controller = new AbortController();
    let reads = 0;
    const reports: string[] = [];
    await expect(
      applyCodeRabbitAutofix({
        initial: formalReviewSnapshot(),
        report: (line) => reports.push(line),
        signal: controller.signal,
        readSnapshot: async () => {
          if (++reads > 1) {
            controller.abort(new Error('cancelled'));
            throw new Error('HTTP 503');
          }
          return formalReviewSnapshot();
        },
        query: async () => ({ success: true, text: '' }),
      }),
    ).rejects.toThrow('cancelled');
    expect(reads).toBe(2);
    expect(reports.some((line) => line.includes('retrying'))).toBe(false);
  });
  test('concurrent human pushes are rejected, not reported as autofix', async () => {
    let reads = 0;
    await expect(
      applyCodeRabbitAutofix({
        initial: formalReviewSnapshot(),
        report: () => {},
        timeoutMs: 100,
        intervalMs: 1,
        readSnapshot: async () => {
          if (++reads === 2) {
            throw new Error('HTTP 503');
          }
          return reads === 1
            ? formalReviewSnapshot()
            : { ...formalReviewSnapshot(), head: OLD_REVIEW_HEAD };
        },
        query: async (args) => ({
          success: true,
          text: '',
          json: args[0] === 'api' ? { ...commit(), author: { login: 'human' } } : undefined,
        }),
      }),
    ).rejects.toThrow('without verified');
  });
  test('a signed commit needs a fresh exact-SHA authenticated provider attestation', async () => {
    let reads = 0;
    const result = await applyCodeRabbitAutofix({
      initial: formalReviewSnapshot(),
      report: () => {},
      timeoutMs: 100,
      readSnapshot: async () => (++reads === 1 ? formalReviewSnapshot() : attestedSnapshot()),
      query: async (args) => ({
        success: true,
        text: '',
        json: args[0] === 'api' ? commit() : undefined,
      }),
    });
    expect(result.status).toBe('committed');
    expect(result.commit).toBe(OLD_REVIEW_HEAD);
  });
  test('signed bot-attributed pushes without provider attestation remain unknown', async () => {
    let reads = 0;
    const result = await applyCodeRabbitAutofix({
      initial: formalReviewSnapshot(),
      report: () => {},
      timeoutMs: 10,
      intervalMs: 1,
      readSnapshot: async () =>
        ++reads === 1
          ? formalReviewSnapshot()
          : { ...formalReviewSnapshot(), head: OLD_REVIEW_HEAD },
      query: async (args) => ({
        success: true,
        text: '',
        json: args[0] === 'api' ? commit() : undefined,
      }),
    });
    expect(result.status).toBe('timeout');
    expect(result.commit).toBeUndefined();
  });
  test('unsigned commits forged with the bot author identity cannot count as autofix', async () => {
    let reads = 0;
    await expect(
      applyCodeRabbitAutofix({
        initial: formalReviewSnapshot(),
        report: () => {},
        timeoutMs: 100,
        readSnapshot: async () => (++reads === 1 ? formalReviewSnapshot() : attestedSnapshot()),
        query: async (args) => ({
          success: true,
          text: '',
          json:
            args[0] === 'api'
              ? { ...commit(), commit: { verification: { verified: false, reason: 'unsigned' } } }
              : undefined,
        }),
      }),
    ).rejects.toThrow('signed ancestry missing');
  });
  test('human, stale, wrong-SHA or failed bot replies cannot attest a push', () => {
    const since = Date.now() - 1000;
    for (const change of [
      { login: 'human' },
      { body: `Autofix applied: ${REVIEW_HEAD}` },
      { body: `autofix-run-id:1 unexpected error; Autofix applied: ${OLD_REVIEW_HEAD}` },
      { createdAt: new Date(since - 1000).toISOString() },
    ]) {
      const snapshot = attestedSnapshot();
      const reply = snapshot.comments.at(-1);
      if (reply) {
        Object.assign(reply, change);
      }
      expect(
        hasAutofixAttestation({
          snapshot,
          request: { since, duplicatePrevented: false },
          head: OLD_REVIEW_HEAD,
        }),
      ).toBe(false);
    }
  });
  test('stale completed replies and unchanged heads cannot be adopted as a new autofix', async () => {
    const snapshot = formalReviewSnapshot();
    snapshot.comments.push({
      ...request(),
      id: 'old-completed',
      login: 'coderabbitai[bot]',
      body: 'Autofix applied',
      createdAt: '2026-10-05T02:00:00Z',
    });
    const result = await applyCodeRabbitAutofix({
      initial: snapshot,
      readSnapshot: async () => snapshot,
      report: () => {},
      timeoutMs: 10,
      intervalMs: 1,
      query: async () => ({ success: true, text: '' }),
    });
    expect(result.status).toBe('timeout');
    expect(result.commit).toBeUndefined();
  });
  test('failed command posts, changed heads, pending reviews and cancellation never proceed', async () => {
    const failing: ReviewQuery = async () => ({ success: false, text: 'HTTP 403' });
    await expect(
      applyCodeRabbitAutofix({
        initial: formalReviewSnapshot(),
        readSnapshot: async () => formalReviewSnapshot(),
        query: failing,
        report: () => {},
      }),
    ).rejects.toThrow('request failed');
    await expect(
      applyCodeRabbitAutofix({
        initial: formalReviewSnapshot(),
        readSnapshot: async () => runningReviewSnapshot(),
        query: failing,
        report: () => {},
      }),
    ).rejects.toThrow('changed before');
    await expect(
      applyCodeRabbitAutofix({
        initial: formalReviewSnapshot(),
        readSnapshot: async () => formalReviewSnapshot(),
        query: failing,
        report: () => {},
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
  });
});
