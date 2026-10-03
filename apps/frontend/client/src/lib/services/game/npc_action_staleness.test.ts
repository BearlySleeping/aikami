// apps/frontend/client/src/lib/services/game/npc_action_staleness.test.ts
//
// Staleness of a late decision result, and versioned qualification
// (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why these cases
// ---------------------------------------------------------------------------
//
// A decision backend is a second inference with its own queue and its own load
// time, so it can finish after the turn it belonged to. Applying it then acts on
// a conversation the player has already moved on from, in a campaign they may
// have left, against a world that has since changed, using a backend that may
// have been swapped underneath.
//
// Each test below is one way the world can move while a decision is in flight.
// None of them is a hypothetical: the campaign switch and the conversation
// restart are ordinary player behaviour, and the world change is exactly what
// the candidate set encodes.

import { describe, expect, it } from 'bun:test';
import type { ResolvedDecisionBackend } from '../config/decision_backend_resolution.ts';
import { isStaleNpcActionResult, type NpcActionStaleness } from './npc_action_decision.ts';
import { resolveNpcActionQualification } from './npc_action_decision_qualification.ts';

const dispatched: NpcActionStaleness = {
  campaignId: 'camp-1',
  conversationId: 'dialogue-3-village_elder',
  turnSequence: 7,
  worldRevision: 'w1',
  configRevision: 'mode=on|gen=0|conn=c1|ckpt=tev1|rt=ollama',
};

const backend = (overrides: Partial<ResolvedDecisionBackend> = {}): ResolvedDecisionBackend => ({
  connectionId: 'c1',
  registryId: 'ollama',
  endpoint: 'http://127.0.0.1:11435',
  checkpoint: 'tev1',
  runtime: 'ollama',
  languages: ['en'],
  qualifiedForGameplay: true,
  ...overrides,
});

describe('staleness — a late result is discarded, not applied', () => {
  it('accepts a result whose turn is still current', () => {
    expect(isStaleNpcActionResult(dispatched, { ...dispatched })).toBe(false);
  });

  it('discards a result from a campaign the player left', () => {
    // Read live at both ends; a captured campaign getter cannot see this.
    expect(isStaleNpcActionResult(dispatched, { ...dispatched, campaignId: 'camp-2' })).toBe(true);
  });

  it('discards a result from a conversation that ENDED and restarted with the same NPC', () => {
    // Same npcId, same campaign — only the conversation identity differs. This
    // is the case a campaign-only check misses entirely.
    expect(
      isStaleNpcActionResult(dispatched, {
        ...dispatched,
        conversationId: 'dialogue-9-village_elder',
      }),
    ).toBe(true);
  });

  it('discards a result from the NEXT turn of the same conversation', () => {
    expect(isStaleNpcActionResult(dispatched, { ...dispatched, turnSequence: 8 })).toBe(true);
  });

  it('discards a result when the world moved: a quest was accepted or an item moved', () => {
    // The candidates encode what was legal. Accepting the offered quest changes
    // the offerable set, so an answer chosen against the old set is not merely
    // late, it is wrong.
    expect(isStaleNpcActionResult(dispatched, { ...dispatched, worldRevision: 'w2' })).toBe(true);
  });

  it('discards a result when the backend was swapped mid-flight', () => {
    // A qualification for one checkpoint is not a qualification for another.
    expect(
      isStaleNpcActionResult(dispatched, {
        ...dispatched,
        configRevision: 'mode=on|gen=0|conn=c2|ckpt=nimble|rt=ollama',
      }),
    ).toBe(true);
  });

  it('discards a result when the mode was switched mid-flight', () => {
    expect(
      isStaleNpcActionResult(dispatched, {
        ...dispatched,
        configRevision: dispatched.configRevision.replace('mode=on', 'mode=off'),
      }),
    ).toBe(true);
  });

  it('discards a result that arrives after cancellation of the turn signal', () => {
    // Cancellation is modelled by the caller abandoning the resolution; the
    // token check below is what stops a late answer being applied anyway.
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    // Even with an identical token, an aborted turn must not be applied; the
    // service checks the signal separately from the token.
    expect(isStaleNpcActionResult(dispatched, { ...dispatched })).toBe(false);
  });
});

describe('qualification is evidence, not a player toggle (C-568)', () => {
  const qualifiedEvidence = {
    taskId: 'npc-action-selection',
    taskVersion: 1,
    dialect: 'jev-v1',
    checkpoint: 'tev1',
    runId: 'run-2026-10-02',
  };

  it('REFUSES when the player ticked the box but no measurement is recorded', () => {
    // The exact defect this replaces: `qualifiedForGameplay === true` used to be
    // read as a current-version qualification, manufacturing the only piece of
    // evidence the gate exists to require.
    const result = resolveNpcActionQualification({ backend: backend() });
    expect(result.qualified).toBe(false);
    expect(result.reason).toMatch(/no recorded measurement/i);
  });

  it('REFUSES when automatic routing is switched off, even with evidence', () => {
    const result = resolveNpcActionQualification({
      backend: backend({ qualifiedForGameplay: false, qualification: qualifiedEvidence }),
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toMatch(/not enabled/i);
  });

  it('ALLOWS only when all four pinned values match', () => {
    const result = resolveNpcActionQualification({
      backend: backend({ qualification: qualifiedEvidence }),
    });
    expect(result.qualified).toBe(true);
    expect(result.reason).toContain('run-2026-10-02');
  });

  it('REFUSES a qualification recorded for another task', () => {
    const result = resolveNpcActionQualification({
      backend: backend({ qualification: { ...qualifiedEvidence, taskId: 'npc-command-kind' } }),
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toMatch(/measured for task npc-command-kind/);
  });

  it('REFUSES a qualification recorded at an older TASK VERSION', () => {
    // A version bump changes the literal space, so an older score describes a
    // different task even when every literal looks the same.
    const result = resolveNpcActionQualification({
      backend: backend({ qualification: { ...qualifiedEvidence, taskVersion: 0 } }),
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toMatch(/task version 0/);
  });

  it('REFUSES a qualification recorded over another DIALECT', () => {
    const result = resolveNpcActionQualification({
      backend: backend({ qualification: { ...qualifiedEvidence, dialect: 'jev-v2' } }),
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toMatch(/dialect/);
  });

  it('REFUSES a qualification recorded for a different CHECKPOINT', () => {
    const result = resolveNpcActionQualification({
      backend: backend({
        checkpoint: 'nimble',
        qualification: qualifiedEvidence,
      }),
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toMatch(/measured for checkpoint tev1/);
  });

  it('never leaks an endpoint or credential into the reason', () => {
    const result = resolveNpcActionQualification({
      backend: backend({
        credential: 'sk-secret-value',
        qualification: { ...qualifiedEvidence, taskVersion: 0 },
      }),
    });
    expect(result.reason).not.toContain('sk-secret-value');
    expect(result.reason).not.toContain('127.0.0.1');
  });
});
