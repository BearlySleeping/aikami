// scripts/src/lib/ops/__tests__/publication_verification.test.ts
//
// What actually happened after a publish — and what a RETRY means.
//
// The bug this pins: verification used to require the pointer's sha to CHANGE
// and the root to match. So a run whose release was already active reported
// "the release pointer did not advance" and exited 1, even though every byte
// behind the pointer verified. The only way to make such a run pass was to
// write a different pointer — fabricating a change to satisfy a check.
//
// The root is the identity. Advancement is a classification.

import { describe, expect, test } from 'bun:test';
import { buildReleaseGraph, entry, sha256 } from '../../catalog/__tests__/release_graph_fixture.ts';
import type { ReleasePointer } from '../emberwatch_release_io.ts';
import { verifyPublishedRelease } from '../emberwatch_release_phases.ts';

const ORIGIN = 'https://assets.example.test';

/** A pointer read result, as `readReleasePointer` would produce it. */
const pointerRead = (options: {
  body?: unknown;
  status?: number;
  sha?: string;
}): ReleasePointer => ({
  key: 'index/v1/release.json',
  status: options.status ?? 200,
  ...(options.sha === undefined ? {} : { sha256: options.sha }),
  ...(options.body === undefined ? {} : { body: options.body }),
});

const graph = (options: { entries?: ReturnType<typeof entry>[]; corruptRoot?: boolean } = {}) =>
  buildReleaseGraph({
    entries: options.entries ?? [entry({ tag: 'sprites:hero', category: 'sprites' })],
    originUrl: ORIGIN,
    ...(options.corruptRoot ? { corruptRoot: true } : {}),
  });

describe('verifyPublishedRelease — distinguishable outcomes', () => {
  test('newly-activated: the pointer now names the planned root', async () => {
    const fixture = graph();
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: fixture.rootHash,
      readPointer: async () => pointerRead({ body: fixture.pointer, sha: sha256('new') }),
      reader: fixture.reader,
    });

    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('newly-activated');
    expect(result.verificationError).toBe('');
  });

  test('already-active: a retry of an active release is a VERIFIED no-op', async () => {
    // The regression. The pointer did not move, and that is success — not
    // "the release pointer did not advance".
    const fixture = graph();
    const active = pointerRead({ body: fixture.pointer, sha: sha256('same') });

    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: active,
      plannedRootHash: fixture.rootHash,
      readPointer: async () => active,
      reader: fixture.reader,
    });

    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('already-active');
    expect(result.verificationError).toBe('');
  });

  test('never-activated: no pointer is published', async () => {
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: 'a'.repeat(64),
      readPointer: async () => pointerRead({ status: 404 }),
      reader: async () => undefined,
    });

    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('never-activated');
  });

  test('wrong-root-active: a pointer exists but names another root', async () => {
    const fixture = graph();
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: 'b'.repeat(64),
      readPointer: async () => pointerRead({ body: fixture.pointer, sha: sha256('other') }),
      reader: fixture.reader,
    });

    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('wrong-root-active');
    expect(result.verificationError).toContain('the plan pinned');
  });

  test('active-graph-invalid: the pointer names the planned root but the graph does not verify', async () => {
    const fixture = graph({ corruptRoot: true });
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: fixture.rootHash,
      readPointer: async () => pointerRead({ body: fixture.pointer, sha: sha256('new') }),
      reader: fixture.reader,
    });

    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('active-graph-invalid');
  });

  test('active-graph-invalid: a malformed pointer is never read as a release', async () => {
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: 'c'.repeat(64),
      readPointer: async () => pointerRead({ body: { schemaVersion: 'nope' }, sha: sha256('x') }),
      reader: async () => undefined,
    });

    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('active-graph-invalid');
  });

  test('active-graph-invalid: a missing shard fails the graph', async () => {
    const fixture = buildReleaseGraph({
      entries: [entry({ tag: 'sprites:hero', category: 'sprites' })],
      originUrl: ORIGIN,
      dropShard: true,
    });
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: fixture.rootHash,
      readPointer: async () => pointerRead({ body: fixture.pointer, sha: sha256('new') }),
      reader: fixture.reader,
    });

    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('active-graph-invalid');
  });

  test('alias-degraded: the immutable release is valid, the mutable alias is not', async () => {
    const fixture = graph();
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: fixture.rootHash,
      aliasDegraded: true,
      readPointer: async () => pointerRead({ body: fixture.pointer, sha: sha256('new') }),
      reader: fixture.reader,
    });

    // The immutable release IS active and valid — rolling it back would be
    // wrong. The degradation is reported, not conflated with failure.
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('alias-degraded');
    expect(result.verificationError).toContain('alias');
  });

  test('remote-verification-failure: the origin could not be read', async () => {
    const result = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: pointerRead({ status: 404 }),
      plannedRootHash: 'd'.repeat(64),
      readPointer: async () => pointerRead({ status: 0, body: { error: 'ECONNREFUSED' } }),
      reader: async () => undefined,
    });

    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('remote-verification-failure');
    expect(result.verificationError).toContain('ECONNREFUSED');
  });

  // Only actual absence is `never-activated`. Auth failures, rate limits and
  // server errors mean the origin could not answer, so they must not be
  // reported as "the release was never activated".
  for (const status of [401, 403, 429, 500, 502, 503]) {
    test(`remote-verification-failure: HTTP ${status} is an unreadable pointer, not absence`, async () => {
      const result = await verifyPublishedRelease({
        originUrl: ORIGIN,
        previous: pointerRead({ status: 404 }),
        plannedRootHash: 'e'.repeat(64),
        readPointer: async () => pointerRead({ status }),
        reader: async () => undefined,
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe('remote-verification-failure');
      expect(result.verificationError).toContain(`HTTP ${status}`);
    });
  }
});

describe('repeat publication', () => {
  test('re-running verification against the same active release stays verified', async () => {
    const fixture = graph();
    const active = pointerRead({ body: fixture.pointer, sha: sha256('same') });

    const first = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: active,
      plannedRootHash: fixture.rootHash,
      readPointer: async () => active,
      reader: fixture.reader,
    });
    const second = await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: active,
      plannedRootHash: fixture.rootHash,
      readPointer: async () => active,
      reader: fixture.reader,
    });

    expect(first.verified).toBe(true);
    expect(second.verified).toBe(true);
    expect(second.outcome).toBe('already-active');
  });

  test('verification never mutates the pointer it reads', async () => {
    // "Never fabricate a pointer change merely to make a retry pass." The
    // function has no writer at all; this pins that the reader is called once
    // and its result is only ever compared.
    const fixture = graph();
    const active = pointerRead({ body: fixture.pointer, sha: sha256('same') });
    let reads = 0;

    await verifyPublishedRelease({
      originUrl: ORIGIN,
      previous: active,
      plannedRootHash: fixture.rootHash,
      readPointer: async () => {
        reads += 1;
        return active;
      },
      reader: fixture.reader,
    });

    expect(reads).toBe(1);
    expect(active.sha256).toBe(sha256('same'));
  });
});
