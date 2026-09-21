// scripts/src/lib/ops/__tests__/plan_phases.test.ts
//
// Plan construction is a MANDATORY phase.
//
// `--plan` used to treat a `buildPlanPhases` failure as a warning: it printed
// "⚠ resolveBaseRelease: …" and then exited 0 whenever the coverage audit
// passed. These pin that a failure to resolve the base release, or to build and
// validate the plan, is returned as a failure the CLI must act on.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReleaseGraph, entry } from '../../catalog/__tests__/release_graph_fixture.ts';
import type { ReleaseTarget } from '../../catalog/release_target.ts';
import { buildCandidateLock } from '../emberwatch_candidate.ts';
import { RELEASE_PLANE_ENV } from '../emberwatch_release_io.ts';
import { buildPlanPhases, verifySealedCandidatePhase } from '../emberwatch_release_phases.ts';

const ORIGIN = 'https://assets.example.test';

const target = (): ReleaseTarget => ({
  mode: 'staging',
  bucket: 'aikami-staging-catalog',
  originUrl: ORIGIN,
  expectedBucket: 'aikami-staging-catalog',
  viaTestSeam: false,
  warnings: [],
});

let plane: string;
let previousPlane: string | undefined;

beforeEach(() => {
  previousPlane = process.env[RELEASE_PLANE_ENV];
  plane = mkdtempSync(join(tmpdir(), 'aikami-plan-plane-'));
  process.env[RELEASE_PLANE_ENV] = plane;
  // A candidate that re-derives from the CURRENT source tree, so candidate
  // verification is not what fails.
  const { lock } = buildCandidateLock();
  writeFileSync(join(plane, 'candidate.latest.json'), JSON.stringify(lock));
});

afterEach(() => {
  rmSync(plane, { recursive: true, force: true });
  if (previousPlane === undefined) {
    delete process.env[RELEASE_PLANE_ENV];
  } else {
    process.env[RELEASE_PLANE_ENV] = previousPlane;
  }
});

describe('buildPlanPhases — mandatory phases fail loudly', () => {
  test('a failed candidate verification is returned, not swallowed', async () => {
    const result = await buildPlanPhases({
      mode: 'staging',
      releaseTarget: target(),
      candidatePhase: { ok: false, phase: 'verifyCandidate', error: 'the candidate moved' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('verifyCandidate');
      expect(result.error).toBe('the candidate moved');
    }
  });

  test('an unverifiable base release fails the plan', async () => {
    // The target serves a pointer whose root bytes do not hash to the pinned
    // value. `resolveBaseRelease` must refuse rather than treat it as absent —
    // corruption is not "no previous release".
    const corrupt = buildReleaseGraph({
      entries: [entry({ tag: 'sprites:hero', category: 'sprites' })],
      originUrl: ORIGIN,
      corruptRoot: true,
    });

    const result = await buildPlanPhases({
      mode: 'staging',
      releaseTarget: target(),
      candidatePhase: verifySealedCandidatePhase(),
      reader: corrupt.reader,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('resolveBaseRelease');
      expect(result.error).toContain('could not be verified');
    }
  });

  test('a first publish with no pointer at all is NOT a failure', async () => {
    // An absent pointer is a legitimate first publish. The plan then proceeds
    // to build from the local catalog — which this checkout may or may not be
    // able to do, so only the base-resolution phase is asserted here.
    const result = await buildPlanPhases({
      mode: 'staging',
      releaseTarget: target(),
      candidatePhase: verifySealedCandidatePhase(),
      reader: async () => undefined,
    });

    const phase = result.ok ? 'plan-built' : result.phase;
    expect(phase).not.toBe('resolveBaseRelease');
  });
});
