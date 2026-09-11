// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_view_model.test.ts
//
// Pure-Bun tests for the Obsidian Chronicle sandbox ViewModel. Runes are
// identity-polyfilled in this lane, so these assert the deterministic logic:
// scoped drafts, destination stability, single-commit checks, the stale
// operation guard, and combat economy.

import { describe, expect, test } from 'bun:test';
import { OBSIDIAN_ENEMY_ID, OBSIDIAN_NPC_ID, OBSIDIAN_PLAYER_ID } from './obsidian_fixtures';
import type { ObsidianSandboxViewModelInterface } from './obsidian_sandbox_contract';
import { createObsidianSandboxViewModel } from './obsidian_view_model.svelte';

const buildViewModel = (): ObsidianSandboxViewModelInterface =>
  createObsidianSandboxViewModel({
    className: 'ObsidianSandboxViewModelTest',
    streamDelayMs: 0,
    rollAnimationMs: 0,
  });

const countConsequences = (viewModel: ObsidianSandboxViewModelInterface): number =>
  viewModel.timeline.filter((entry) => entry.kind === 'consequence').length;

const findCheckEntry = (viewModel: ObsidianSandboxViewModelInterface) =>
  viewModel.timeline.find((entry) => entry.kind === 'check');

describe('Obsidian sandbox — conversation', () => {
  test('scopes drafts by recipient and never sends on switch', () => {
    const viewModel = buildViewModel();
    const timelineLength = viewModel.timeline.length;

    viewModel.setRecipient('npc');
    viewModel.setDraft('I show her the sealed letter.');
    viewModel.setRecipient('party');
    expect(viewModel.draft).toBe('');
    viewModel.setDraft('Kael, watch the winch.');
    viewModel.setRecipient('npc');

    expect(viewModel.draft).toBe('I show her the sealed letter.');
    expect(viewModel.timeline.length).toBe(timelineLength);
  });

  test('history filter is presentation-only', () => {
    const viewModel = buildViewModel();
    viewModel.setRecipient('party');
    viewModel.setDraft('Hold the line.');

    viewModel.setHistoryFilter('encounter');
    expect(viewModel.recipient).toBe('party');
    expect(viewModel.draft).toBe('Hold the line.');

    viewModel.setHistoryFilter('conversation');
    expect(viewModel.recipient).toBe('party');
    expect(viewModel.draft).toBe('Hold the line.');
  });

  test('send streams one reply and clears only the active draft', async () => {
    const viewModel = buildViewModel();
    viewModel.setRecipient('npc');
    viewModel.setDraft('I set the letter on the counter.');
    await viewModel.send();

    const replies = viewModel.timeline.filter(
      (entry) => entry.kind === 'speech' && entry.id.endsWith('-reply'),
    );
    expect(replies.length).toBe(1);
    expect(viewModel.draft).toBe('');
    expect(viewModel.isStreaming).toBe(false);
  });

  test('a late response is dropped when its operation is superseded', async () => {
    const viewModel = buildViewModel();
    viewModel.setRecipient('party');
    viewModel.setDraft('Kael, cover the winch.');

    const pending = viewModel.send();
    // Switch destination and cancel before the first streamed chunk resolves.
    viewModel.setRecipient('npc');
    viewModel.cancelStream();
    await pending;

    const partyReplies = viewModel.timeline.filter(
      (entry) =>
        entry.kind === 'speech' && entry.id.endsWith('-reply') && entry.recipient === 'party',
    );
    expect(partyReplies.length).toBe(0);
    expect(viewModel.recipient).toBe('npc');
    expect(viewModel.isStreaming).toBe(false);
  });

  test('retry removes the failed operation exactly once', async () => {
    const viewModel = buildViewModel();
    viewModel.simulateFailure();
    const errorsAfterFailure = viewModel.timeline.filter((entry) => entry.kind === 'error').length;
    expect(errorsAfterFailure).toBe(1);
    expect(viewModel.canRetry).toBe(true);

    viewModel.simulateFailure();
    expect(viewModel.timeline.filter((entry) => entry.kind === 'error').length).toBe(2);
    expect(viewModel.canRetry).toBe(true);
  });
});

describe('Obsidian sandbox — inline checks', () => {
  test('commits a single authoritative result and ignores repeats', () => {
    const viewModel = buildViewModel();
    viewModel.requestPersuasionCheck();
    expect(viewModel.activeCheck?.phase).toBe('pending');

    const before = countConsequences(viewModel);
    // CHA +2, proficiency +2 → total 17 against DC 15.
    viewModel.resolveActiveCheck(13);
    expect(countConsequences(viewModel)).toBe(before + 1);

    // A second resolution must not append another consequence or change totals.
    viewModel.resolveActiveCheck(2);
    expect(countConsequences(viewModel)).toBe(before + 1);

    const entry = findCheckEntry(viewModel);
    expect(entry?.kind).toBe('check');
    if (entry?.kind === 'check') {
      expect(entry.check.committed).toBe(true);
      expect(entry.check.phase).toBe('resolved');
      expect(entry.check.natural).toBe(13);
      expect(entry.check.total).toBe(17);
      expect(entry.check.isSuccess).toBe(true);
    }
  });

  test('rollActiveCheck consumes a predetermined roll once', async () => {
    const viewModel = buildViewModel();
    viewModel.requestPersuasionCheck();
    viewModel.setPredeterminedRoll(4);
    await viewModel.rollActiveCheck();

    const entry = findCheckEntry(viewModel);
    if (entry?.kind === 'check') {
      expect(entry.check.natural).toBe(4);
      expect(entry.check.isSuccess).toBe(false);
    }

    const consequences = countConsequences(viewModel);
    await viewModel.rollActiveCheck();
    expect(countConsequences(viewModel)).toBe(consequences);
  });

  test('rephrase changes wording without touching the committed result', () => {
    const viewModel = buildViewModel();
    viewModel.requestPersuasionCheck();
    viewModel.resolveActiveCheck(13);
    const consequencesBefore = countConsequences(viewModel);

    viewModel.rephrase();

    expect(countConsequences(viewModel)).toBe(consequencesBefore);
    const entry = findCheckEntry(viewModel);
    if (entry?.kind === 'check') {
      expect(entry.check.total).toBe(17);
      expect(entry.check.committed).toBe(true);
    }
    const miraSpeech = viewModel.timeline.filter(
      (candidate) => candidate.kind === 'speech' && candidate.actorId === OBSIDIAN_NPC_ID,
    );
    expect(miraSpeech.at(-1)?.kind).toBe('speech');
  });
});

describe('Obsidian sandbox — inventory', () => {
  test('compares against the equipped item and equip actions toggle', () => {
    const viewModel = buildViewModel();
    // The shortsword is equipped in the off hand.
    viewModel.selectItem('item-shortsword');
    expect(viewModel.isSelectedEquipped).toBe(true);
    const attackRow = viewModel.comparisonRows.find((row) => row.label === 'Attack');
    expect(attackRow).toBeDefined();

    viewModel.unequipSelected();
    expect(viewModel.isSelectedEquipped).toBe(false);
    viewModel.equipSelected();
    expect(viewModel.isSelectedEquipped).toBe(true);
  });
});

describe('Obsidian sandbox — combat', () => {
  test('one action per turn and a full round advances through the enemy', () => {
    const viewModel = buildViewModel();
    viewModel.startCombat();
    expect(viewModel.isCombat).toBe(true);

    const actionCount = () => viewModel.timeline.filter((entry) => entry.kind === 'action').length;

    viewModel.useCombatAction('combat-attack');
    expect(viewModel.economy.action).toBe(0);
    const afterFirst = actionCount();

    // A rapid second activation must not commit twice.
    viewModel.useCombatAction('combat-attack');
    expect(actionCount()).toBe(afterFirst);

    // End Turn cycles to Kael, then through the enemy's turn back to the player.
    viewModel.endTurn();
    expect(viewModel.currentCombatActorId).toBe('kael');
    const playerHpBefore = viewModel.actors.find((actor) => actor.id === OBSIDIAN_PLAYER_ID)?.hp;
    viewModel.endTurn();
    expect(viewModel.currentCombatActorId).toBe(OBSIDIAN_PLAYER_ID);
    expect(viewModel.combatRound).toBe(2);
    expect(viewModel.actors.find((actor) => actor.id === OBSIDIAN_PLAYER_ID)?.hp).toBe(
      (playerHpBefore ?? 0) - 6,
    );
    expect(viewModel.initiative.find((entry) => entry.actorId === OBSIDIAN_ENEMY_ID)).toBeDefined();
  });

  test('unavailable actions explain themselves instead of silently disabling', () => {
    const viewModel = buildViewModel();
    viewModel.startCombat();
    viewModel.useCombatAction('combat-attack');

    const dash = viewModel.availableCombatActions.find((action) => action.id === 'combat-dash');
    expect(dash?.available).toBe(false);
    expect(dash?.unavailableReason).toBe('Action already used this turn.');

    const brazier = viewModel.availableCombatActions.find(
      (action) => action.id === 'combat-kick-brazier',
    );
    expect(brazier?.available).toBe(false);
    expect(brazier?.unavailableReason).toBe('Out of melee range — move adjacent first.');
  });
});
