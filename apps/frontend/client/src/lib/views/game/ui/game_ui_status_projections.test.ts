// apps/frontend/client/src/lib/views/game/ui/game_ui_status_projections.test.ts
//
// C-543 — unit tests for the pure HUD status projections.
//
// The percentage/tone policy and the party attention band live in the
// projection module, so they are provable without a browser or a Svelte rune.
//
// Contract: C-543 AC-3.

import { describe, expect, test } from 'bun:test';
import type { PartyRosterEntry } from '@aikami/types';
import { projectPartyStatus, projectPlayerStatus } from './game_ui_status_projections.ts';

const member = (overrides: Partial<PartyRosterEntry> = {}): PartyRosterEntry => ({
  npcId: 'lydia',
  name: 'Lydia',
  classId: 'cleric',
  level: 3,
  approval: 0,
  recruitedAt: '2026-01-01T00:00:00.000Z',
  personalQuestActive: false,
  equipmentSlotIds: [],
  ...overrides,
});

describe('projectPlayerStatus', () => {
  test('reports a healthy tone above half health', () => {
    const status = projectPlayerStatus(40, 80);
    expect(status.percent).toBe(50);
    expect(status.tone).toBe('warning');
    expect(status.toneLabel).toBe('Wounded');
    expect(status.valueLabel).toBe('40/80');
  });

  test('bands the tone and always pairs it with a readable label', () => {
    expect(projectPlayerStatus(80, 80).tone).toBe('healthy');
    expect(projectPlayerStatus(30, 80).tone).toBe('warning');
    expect(projectPlayerStatus(10, 80).tone).toBe('danger');
    expect(projectPlayerStatus(10, 80).toneLabel).toBe('Critical');
  });

  test('a zero or absent maximum cannot divide by zero', () => {
    const status = projectPlayerStatus(10, 0);
    expect(status.percent).toBe(0);
    expect(status.tone).toBe('danger');
  });
});

describe('projectPartyStatus', () => {
  test('an empty party is empty and needs no attention', () => {
    const status = projectPartyStatus({ activeCount: 0, maxSize: 4, members: [] });
    expect(status.isEmpty).toBe(true);
    expect(status.label).toBe('0/4');
    expect(status.needsAttention).toBe(false);
  });

  test('projects identity from the real member fields and a neutral avatar', () => {
    const status = projectPartyStatus({
      activeCount: 1,
      maxSize: 4,
      members: [member()],
    });
    expect(status.isEmpty).toBe(false);
    expect(status.members[0]?.initial).toBe('L');
    expect(status.members[0]?.classId).toBe('cleric');
    expect(status.members[0]?.approvalTone).toBe('neutral');
    expect(status.needsAttention).toBe(false);
  });

  test('raises an explicit attention marker for unhappy and hostile approval', () => {
    const warning = projectPartyStatus({
      activeCount: 1,
      maxSize: 4,
      members: [member({ approval: -10 })],
    });
    expect(warning.members[0]?.approvalTone).toBe('warning');
    expect(warning.members[0]?.approvalLabel).toBe('Unhappy');
    expect(warning.needsAttention).toBe(true);

    const danger = projectPartyStatus({
      activeCount: 1,
      maxSize: 4,
      members: [member({ approval: -60 })],
    });
    expect(danger.members[0]?.approvalTone).toBe('danger');
    expect(danger.members[0]?.approvalLabel).toBe('Hostile');
    expect(danger.needsAttention).toBe(true);
  });
});
