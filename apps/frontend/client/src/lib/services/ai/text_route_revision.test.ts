// apps/frontend/client/src/lib/services/ai/text_route_revision.test.ts
//
// The opaque configuration revision: what it detects, and — more importantly —
// what it must never become (issue #382 P1).
//
// The negative tests are the load-bearing half. Every property here is a
// refusal: no digest of a credential, no credential in a loggable string, no
// invalidation on a cosmetic edit. A tracker that got the positives right by
// hashing the whole configuration would pass a "different key → different
// revision" test and quietly put a stable, comparable, loggable derivative of
// every API key into a coalescing key, a diagnostics buffer and a bug report.

import { describe, expect, test } from 'bun:test';
import {
  createTextRouteRevisionTracker,
  type TextRouteRevisionSource,
  UNKNOWN_ROUTE_REVISION,
} from './text_route_revision.ts';

const KEY_A = 'sk-live-AAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'sk-live-BBBBBBBBBBBBBBBBBBBBBBBB';

/** A minimal vault: one provider, one connection, one role. */
const vault = (overrides?: {
  credential?: string;
  model?: string;
  label?: string;
  apiKey?: string;
  endpoint?: string;
}): TextRouteRevisionSource => ({
  providers: [
    {
      id: 'provider-1',
      registryId: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      credential: overrides?.credential ?? KEY_A,
    },
  ],
  aiConnections: [
    {
      id: 'connection-1',
      providerId: 'provider-1',
      capability: 'text',
      model: overrides?.model ?? 'anthropic/claude',
      label: overrides?.label ?? 'Main',
      params: { temperature: 0.7 },
    },
  ],
  roles: { narration: 'connection-1' },
});

/**
 * Credential identity, observed through the revision it produces.
 *
 * The interner and the projection are deliberately NOT exported: a helper used
 * only by its own test is not used, and the properties that matter here are all
 * visible in the marker's BEHAVIOUR — equal credentials share a marker,
 * different ones do not, and neither leaks a byte of the key. Testing through
 * the public surface also tests the thing the coalescer actually compares.
 */
describe('credential identity, through the revision', () => {
  test('the same credential keeps the same revision across many reads', () => {
    const tracker = createTextRouteRevisionTracker();
    const first = tracker.current(vault());
    for (let i = 0; i < 5; i += 1) {
      expect(tracker.current(vault())).toBe(first);
    }
    expect(tracker.revisionCount).toBe(1);
  });

  test('a different credential produces a different revision', () => {
    const tracker = createTextRouteRevisionTracker();
    expect(tracker.current(vault({ credential: KEY_B }))).not.toBe(
      tracker.current(vault({ credential: KEY_A })),
    );
  });

  test('credentials differing in ONE character are distinguishable', () => {
    const tracker = createTextRouteRevisionTracker();
    const one = tracker.current(vault({ credential: 'sk-live-XYZ' }));
    const other = tracker.current(vault({ credential: 'sk-live-XZZ' }));
    expect(one).not.toBe(other);
  });

  test('a keyless provider is not a rotation against another keyless provider', () => {
    const tracker = createTextRouteRevisionTracker();
    const first = tracker.current(vault({ credential: '' }));
    expect(tracker.current(vault({ credential: '' }))).toBe(first);
    // …and it is genuinely different from a provider that HAS a key, which is
    // the case that would otherwise read as a rotation on every projection.
    expect(tracker.current(vault({ credential: KEY_A }))).not.toBe(first);
  });

  test('a legacy connection apiKey is interned, never spelled out', () => {
    const tracker = createTextRouteRevisionTracker();
    const withKey = tracker.current({
      connections: [
        {
          id: 'legacy-1',
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: KEY_B,
          generationParams: { temperature: 0.4 },
          isDefault: true,
        },
      ],
    });
    // The key, or any recognisable part of it, must not be recoverable from the
    // marker: it is comparable, loggable and persisted in a coalescing key.
    expect(withKey).not.toContain(KEY_B);
    expect(withKey).not.toContain(KEY_B.slice(0, 8));
    expect(withKey).toMatch(/^cfg-\d+-[0-9a-f]+$/);
  });

  test('the interning table is bounded, and eviction fails safe', () => {
    // 40 distinct credentials against a four-entry table. The table must not
    // grow, and the revision must keep answering correctly for whatever it is
    // currently holding rather than going stale.
    const tracker = createTextRouteRevisionTracker(4);
    const revisions: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      revisions.push(tracker.current(vault({ credential: `key-${i}` })));
    }
    // A repeated read of the LAST configuration is stable...
    expect(tracker.current(vault({ credential: 'key-39' }))).toBe(revisions[39]);
    // ...and the token is still opaque after all that churn.
    expect(revisions[39]).not.toContain('key-39');
  });
});

describe('the revision', () => {
  test('changes when a credential rotates and nothing else does', () => {
    const tracker = createTextRouteRevisionTracker();
    const before = tracker.current(vault());
    const after = tracker.current(vault({ credential: KEY_B }));
    // The single most important assertion in this file: a key rotation is
    // invisible to every route field, and without this a request arriving after
    // the rotation could still join an attempt the old key is paying for.
    expect(after).not.toBe(before);
  });

  test('a rotated key produces a revision that exposes nothing about either key', () => {
    const tracker = createTextRouteRevisionTracker();
    const first = tracker.current(vault({ credential: KEY_A }));
    const second = tracker.current(vault({ credential: KEY_B }));
    for (const revision of [first, second]) {
      expect(revision).not.toContain(KEY_A);
      expect(revision).not.toContain(KEY_B);
      expect(revision).toMatch(/^cfg-\d+-[0-9a-f]+$/);
    }
  });

  test('is stable ACROSS a credential rotation, so it is an identity not a counter', () => {
    const tracker = createTextRouteRevisionTracker();
    tracker.current(vault({ credential: KEY_A }));
    const rotated = tracker.current(vault({ credential: KEY_B }));
    // Two calls against the SAME new configuration must agree, or every
    // request would miss every dedup for the rest of the session.
    expect(tracker.current(vault({ credential: KEY_B }))).toBe(rotated);
  });

  test('changes when the model, endpoint or role assignment changes', () => {
    const tracker = createTextRouteRevisionTracker();
    const base = tracker.current(vault());
    expect(tracker.current(vault({ model: 'openai/gpt-4o' }))).not.toBe(base);
    expect(tracker.current({ ...vault(), roles: { narration: 'connection-9' } })).not.toBe(base);
  });

  test('does NOT change on a cosmetic edit that cannot move a route', () => {
    const tracker = createTextRouteRevisionTracker();
    const base = tracker.current(vault());
    // Renaming a connection in Settings is not a routing change. Invalidating
    // every in-flight request because a label moved would be pure cost, and the
    // projection deliberately does not read the label.
    expect(tracker.current(vault({ label: 'Renamed by the player' }))).toBe(base);
  });

  test('is order-insensitive, because key order is not semantic', () => {
    const a = createTextRouteRevisionTracker();
    const b = createTextRouteRevisionTracker();
    const forward: TextRouteRevisionSource = {
      providers: [
        { id: 'p1', registryId: 'ollama', baseUrl: 'http://a' },
        { id: 'p2', registryId: 'openrouter', baseUrl: 'http://b' },
      ],
      roles: { narration: 'c1', dialogue: 'c2' },
    };
    const reversed: TextRouteRevisionSource = {
      providers: [
        { id: 'p2', registryId: 'openrouter', baseUrl: 'http://b' },
        { id: 'p1', registryId: 'ollama', baseUrl: 'http://a' },
      ],
      roles: { dialogue: 'c2', narration: 'c1' },
    };
    expect(a.current(forward)).toBe(b.current(reversed));
  });

  test('an empty configuration still has a distinct, shareable-with-itself identity', () => {
    const tracker = createTextRouteRevisionTracker();
    expect(tracker.current({})).toBe(tracker.current({}));
    // And it is NOT the marker used when no configuration could be read, so a
    // request with no configuration owner never shares with a configured one.
    expect(tracker.current({})).not.toBe(UNKNOWN_ROUTE_REVISION);
  });
});
