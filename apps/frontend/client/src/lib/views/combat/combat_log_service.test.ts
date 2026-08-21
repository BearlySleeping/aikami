// apps/frontend/client/src/lib/views/combat/combat_log_service.test.ts
//
// Unit tests for the CombatLogService sub-service (C-425 / C-165).
// Verifies actor parsing, entry creation, and inline-image updates.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/combat_log_service.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  type CombatLogServiceInterface,
  getCombatLogService,
} from './combat_log_service.svelte.ts';

const createService = (): CombatLogServiceInterface =>
  getCombatLogService({ className: 'CombatLogServiceTest' });

describe('CombatLogService (C-425)', () => {
  let svc: CombatLogServiceInterface;

  beforeEach(() => {
    svc = createService();
  });

  describe('parseActor', () => {
    test('returns Player for player messages', () => {
      expect(svc.parseActor('Player rolls 17 to hit', 'Goblin')).toBe('Player');
    });

    test('returns the enemy name for enemy messages', () => {
      expect(svc.parseActor('Enemy attacks — 8 damage!', 'Goblin')).toBe('Goblin');
    });

    test('falls back to Enemy when no enemy name is set', () => {
      expect(svc.parseActor('Enemy attacks', '')).toBe('Enemy');
    });

    test('falls back to System for unrecognized messages', () => {
      expect(svc.parseActor('The ground shakes violently!', 'Goblin')).toBe('System');
    });
  });

  describe('createEntry', () => {
    test('builds a structured entry with defaults', () => {
      const entry = svc.createEntry({
        id: 'log-1',
        turnNumber: 2,
        actor: 'Player',
        actionText: 'You strike!',
      });
      expect(entry).toEqual({
        id: 'log-1',
        turnNumber: 2,
        actor: 'Player',
        actionText: 'You strike!',
        outcomeText: '',
      });
    });

    test('carries optional image fields', () => {
      const entry = svc.createEntry({
        id: 'log-2',
        turnNumber: 1,
        actor: 'Player',
        actionText: 'A flash of light!',
        isGeneratingImage: true,
      });
      expect(entry.isGeneratingImage).toBe(true);
      expect(entry.imageUrl).toBeUndefined();
    });
  });

  describe('updateEntryImage', () => {
    const base = [
      { id: 'entry-1', turnNumber: 1, actor: 'Player', actionText: 'You strike!', outcomeText: '' },
    ];

    test('sets imageUrl and clears isGeneratingImage', () => {
      const entries = [
        {
          id: 'entry-1',
          turnNumber: 1,
          actor: 'Player',
          actionText: 'You strike!',
          outcomeText: '',
          isGeneratingImage: true,
        },
      ];
      const result = svc.updateEntryImage(entries, 'entry-1', 'https://example.com/img.png');
      expect(result[0]?.imageUrl).toBe('https://example.com/img.png');
      expect(result[0]?.isGeneratingImage).toBe(false);
    });

    test('is a no-op for an unknown entry id', () => {
      const result = svc.updateEntryImage(base, 'nonexistent', 'https://example.com/img.png');
      expect(result[0]?.id).toBe('entry-1');
      expect(result[0]?.imageUrl).toBeUndefined();
    });

    test('with undefined clears isGeneratingImage only', () => {
      const entries = [
        {
          id: 'entry-1',
          turnNumber: 1,
          actor: 'Player',
          actionText: 'You strike!',
          outcomeText: '',
          isGeneratingImage: true,
        },
      ];
      const result = svc.updateEntryImage(entries, 'entry-1', undefined);
      expect(result[0]?.isGeneratingImage).toBe(false);
      expect(result[0]?.imageUrl).toBeUndefined();
    });

    test('does not mutate the input array', () => {
      const result = svc.updateEntryImage(base, 'entry-1', 'https://example.com/img.png');
      expect(base[0]?.imageUrl).toBeUndefined();
      expect(result).not.toBe(base);
    });
  });
});
