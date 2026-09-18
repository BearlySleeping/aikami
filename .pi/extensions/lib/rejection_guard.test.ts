// .pi/extensions/lib/rejection_guard.test.ts
//
// The workaround's expiry contract is the only thing that stops it becoming
// permanent infrastructure, so it is pinned here:
//
//   • the version it was written for installs the handler;
//   • a LATER version does not, and says so;
//   • an unknown version installs it (conservative — a missing manifest must
//     not reintroduce the intermittent pipeline failure it absorbs).

import { describe, expect, test } from 'bun:test';
import { compareVersions, isWorkaroundStillNeeded, WORKAROUND } from '../rejection_guard.ts';

describe('compareVersions', () => {
  test('orders dotted numeric versions', () => {
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0);
    expect(compareVersions('0.1.2', '0.1.3')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.1.3')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
  });

  test('treats a non-numeric segment as unknown rather than guessing', () => {
    expect(compareVersions('0.1.3-beta.1', '0.1.3')).toBe(0);
  });
});

describe('isWorkaroundStillNeeded', () => {
  test('is needed at the version it was written for', () => {
    expect(isWorkaroundStillNeeded(WORKAROUND.introducedFor)).toBe(true);
  });

  test('is needed for an older version', () => {
    expect(isWorkaroundStillNeeded('0.1.0')).toBe(true);
  });

  test('is NOT needed once the dependency moves past it', () => {
    expect(isWorkaroundStillNeeded('0.1.4')).toBe(false);
    expect(isWorkaroundStillNeeded('0.2.0')).toBe(false);
    expect(isWorkaroundStillNeeded('1.0.0')).toBe(false);
  });

  test('an unknown version installs the handler (conservative)', () => {
    expect(isWorkaroundStillNeeded(undefined)).toBe(true);
  });
});

describe('the workaround record', () => {
  test('names the package, the version, an owner-facing deadline and the removal step', () => {
    expect(WORKAROUND.package.length).toBeGreaterThan(0);
    expect(WORKAROUND.introducedFor).toMatch(/^\d+\.\d+\.\d+$/);
    expect(WORKAROUND.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(WORKAROUND.upstream.length).toBeGreaterThan(0);
    expect(WORKAROUND.removalNote).toContain('Delete this extension');
  });
});
