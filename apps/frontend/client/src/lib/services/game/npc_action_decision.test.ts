// apps/frontend/client/src/lib/services/game/npc_action_decision.test.ts
//
// Routing, staleness and budget rules for the decision consumer
// (issue #381, lane C).
//
// Each test here pins a rule the prompt requires by name, so a regression says
// which promise broke rather than just that a boolean flipped.

import { describe, expect, it } from 'bun:test';
import { NPC_ACTION_SELECTION_TASK_ID } from '@aikami/frontend-ai-gateway/decision/tasks';
import {
  enumerateNpcActionCandidates,
  type NpcActionCandidateSet,
} from './npc_action_candidates.ts';
import {
  hasFallbackBudget,
  isStaleNpcActionResult,
  type NpcActionQualification,
  type NpcActionStaleness,
  resolveNpcActionRoute,
} from './npc_action_decision.ts';

const candidates = (complete = true): NpcActionCandidateSet => ({
  candidates: [
    { id: 'none', kind: 'none', label: 'none' },
    {
      id: 'offerQuest:fading_ward',
      kind: 'offerQuest',
      command: { kind: 'offerQuest', questId: 'fading_ward' },
      label: 'offer',
    },
  ],
  omissions: [],
  complete,
});

const qualified = (overrides: Partial<NpcActionQualification> = {}): NpcActionQualification => ({
  qualified: true,
  taskId: NPC_ACTION_SELECTION_TASK_ID,
  taskVersion: 1,
  dialect: 'jev-v1',
  checkpoint: 'tev1',
  reason: 'measured pass',
  ...overrides,
});

describe('routing — qualification is pinned to four things', () => {
  it('routes when task, task version, dialect and checkpoint all match', () => {
    const route = resolveNpcActionRoute({
      mode: 'on',
      configured: true,
      qualification: qualified(),
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates: candidates(),
    });
    expect(route.route).toBe('decision');
  });

  it('refuses when the backend answered a sample but no task was qualified', () => {
    const route = resolveNpcActionRoute({
      mode: 'on',
      configured: true,
      qualification: qualified({ qualified: false, reason: 'sample inference only' }),
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates: candidates(),
    });
    expect(route).toMatchObject({ route: 'llm', refusal: 'not-qualified' });
  });

  it('refuses a qualification recorded against a DIFFERENT task', () => {
    // The probe's measurement says nothing about this task.
    const route = resolveNpcActionRoute({
      mode: 'on',
      configured: true,
      qualification: qualified({ taskId: 'npc-command-kind' }),
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates: candidates(),
    });
    expect(route).toMatchObject({ route: 'llm', refusal: 'task-mismatch' });
  });

  it('refuses when no backend is configured at all', () => {
    const route = resolveNpcActionRoute({
      mode: 'on',
      configured: false,
      qualification: qualified(),
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates: candidates(),
    });
    expect(route).toMatchObject({ route: 'llm', refusal: 'not-configured' });
  });

  it('refuses mode `off` before anything else is even consulted', () => {
    // This is the immediate-rollback path: `off` wins even against a fully
    // qualified backend, with no reload and no restart.
    const route = resolveNpcActionRoute({
      mode: 'off',
      configured: true,
      qualification: qualified(),
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates: candidates(),
    });
    expect(route).toMatchObject({ route: 'llm', refusal: 'mode-off' });
  });

  it('never routes an INCOMPLETE candidate set, in any mode', () => {
    // A backend shown a bounded subset of the world would answer confidently
    // about a world it was never shown. Shadow included: measuring a wrong
    // question would poison the very evidence that would qualify a backend.
    for (const mode of ['on', 'shadow'] as const) {
      const route = resolveNpcActionRoute({
        mode,
        configured: true,
        qualification: qualified(),
        taskId: NPC_ACTION_SELECTION_TASK_ID,
        candidates: candidates(false),
      });
      expect(route).toMatchObject({ route: 'llm', refusal: 'candidate-set-incomplete' });
    }
  });

  it('dispatches in shadow without requiring qualification, but discards the answer', () => {
    // Shadow exists to accumulate the evidence that would QUALIFY a backend, so
    // gating it on qualification would mean it could never start.
    const route = resolveNpcActionRoute({
      mode: 'shadow',
      configured: true,
      qualification: qualified({ qualified: false, reason: 'not yet measured' }),
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates: candidates(),
    });
    expect(route.route).toBe('decision');
    expect(route.reason).toContain('shadow');
  });
});

describe('staleness — a late result belongs to a turn that no longer exists', () => {
  const dispatched: NpcActionStaleness = {
    campaignId: 'camp-1',
    conversationId: 'dialogue-3-village_elder',
    turnSequence: 7,
    stateRevision: 7,
  };

  it('accepts a result whose turn is still current', () => {
    expect(isStaleNpcActionResult(dispatched, { ...dispatched })).toBe(false);
  });

  it('discards a result from a campaign the player left', () => {
    expect(isStaleNpcActionResult(dispatched, { ...dispatched, campaignId: 'camp-2' })).toBe(true);
  });

  it('discards a result from a previous conversation with the SAME npc', () => {
    // Without a conversation id in the token, re-opening a dialogue with the
    // same NPC would look identical and a stale answer would apply.
    expect(
      isStaleNpcActionResult(dispatched, {
        ...dispatched,
        conversationId: 'dialogue-9-village_elder',
      }),
    ).toBe(true);
  });

  it('discards a result from an earlier turn of the same conversation', () => {
    expect(isStaleNpcActionResult(dispatched, { ...dispatched, turnSequence: 8 })).toBe(true);
  });

  it('discards a result computed against a world revision that has moved on', () => {
    expect(isStaleNpcActionResult(dispatched, { ...dispatched, stateRevision: 9 })).toBe(true);
  });
});

/**
 * The minimum remaining budget before a fallback is worth starting.
 *
 * Duplicated here rather than imported: the constant is module-private because
 * a capability exported only for a test is a capability nothing uses. The test
 * asserts the RULE, not that the number happens to live in a particular module.
 */
const FALLBACK_BUDGET_MS = 250;

describe('fallback budget — one deadline, read once', () => {
  it('allows a fallback when the turn still has real budget left', () => {
    const now = 1_000_000;
    expect(hasFallbackBudget({ deadlineAt: now + 10_000, now })).toBe(true);
  });

  it('refuses a fallback when what is left cannot finish a second call', () => {
    const now = 1_000_000;
    expect(hasFallbackBudget({ deadlineAt: now + FALLBACK_BUDGET_MS - 1, now })).toBe(false);
  });

  it('refuses a fallback once the deadline is already spent', () => {
    const now = 1_000_000;
    expect(hasFallbackBudget({ deadlineAt: now - 1, now })).toBe(false);
  });
});

describe('enumeration stays complete for the shipped NPC set', () => {
  it('produces a complete candidate set for a vendor holding six items', () => {
    const set = enumerateNpcActionCandidates({
      npcId: 'merchant',
      npcName: 'Mara the Merchant',
      allowedCommands: ['trade', 'offerQuest', 'skillCheck', 'giveItem', 'presentEvidence'],
      isVendor: true,
      isCompanion: false,
      hasCombatStats: false,
      vendorInventory: [
        'ironSword',
        'steelSword',
        'healthPotion',
        'manaPotion',
        'ironArmor',
        'woodenShield',
      ],
      offerableQuests: [{ id: 'fading_ward', name: 'The Fading Ward' }],
      discoverableEvidence: [
        { id: 'the_ledger', label: 'Ledger', presentToNpcId: 'merchant' },
        { id: 'sella_receipt', label: 'Receipt', presentToNpcId: 'merchant' },
        { id: 'tess_component', label: 'Component', presentToNpcId: 'merchant' },
      ],
    });
    expect(set.complete).toBe(true);
  });
});
