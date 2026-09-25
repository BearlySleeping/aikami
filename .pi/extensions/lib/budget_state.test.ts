// .pi/extensions/lib/budget_state.test.ts

import { describe, expect, test } from 'bun:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { BudgetCommand, BudgetMutationCommand } from './budget_state.ts';
import {
  applyBudgetCommand,
  BUDGET_ENTRY_TYPE,
  createPersistedBudget,
  findPersistedBudget,
  parseBudgetCommand,
  restoreSessionSpend,
} from './budget_state.ts';

const _parse = (args: string): BudgetCommand => {
  const parsed = parseBudgetCommand(args);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.command;
};

const _apply = (options: {
  readonly command: BudgetMutationCommand;
  readonly current?: { readonly softCap: number; readonly hardCap: number };
  readonly spend?: number;
  readonly ceiling?: number;
}) => {
  const result = applyBudgetCommand({
    command: options.command,
    current: options.current ?? { softCap: 10, hardCap: 15 },
    defaults: { softCap: 10, hardCap: 15 },
    ceiling: options.ceiling ?? 200,
    spend: options.spend ?? 0,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.change;
};

describe('budget command parsing', () => {
  const VALID_CASES: Array<[string, BudgetCommand]> = [
    ['', { action: 'show' }],
    ['soft 20', { action: 'set-soft', amount: 20, force: false }],
    ['soft $20', { action: 'set-soft', amount: 20, force: false }],
    ['soft 20.5', { action: 'set-soft', amount: 20.5, force: false }],
    ['hard 30', { action: 'set-hard', amount: 30, force: false }],
    ['+10', { action: 'raise-both', amount: 10, force: false }],
    ['+10.5', { action: 'raise-both', amount: 10.5, force: false }],
    ['reset', { action: 'reset', force: false }],
    ['hard 300 --force', { action: 'set-hard', amount: 300, force: true }],
  ];

  test.each(VALID_CASES)('parses %p', (args, expected) => {
    expect(_parse(args)).toEqual(expected);
  });

  test.each([
    'nonsense',
    'soft',
    'soft 0',
    'soft $-1',
    '$-1',
    'hard Infinity',
    'hard 20 extra',
    '+',
    '-10',
    'reset now',
    '--force',
  ])('rejects bad input %p', (args) => {
    expect(parseBudgetCommand(args).ok).toBe(false);
  });
});

describe('budget cap transitions', () => {
  test('auto-raises hard when a hard setter falls below soft', () => {
    const change = _apply({
      command: { action: 'set-hard', amount: 5, force: false },
      current: { softCap: 20, hardCap: 30 },
    });

    expect(change.after).toEqual({ softCap: 20, hardCap: 20 });
    expect(change.hardAutoRaised).toBe(true);
  });

  test('auto-raises hard when a soft setter moves above hard', () => {
    const change = _apply({
      command: { action: 'set-soft', amount: 30, force: false },
      current: { softCap: 20, hardCap: 25 },
    });

    expect(change.after).toEqual({ softCap: 30, hardCap: 30 });
    expect(change.hardAutoRaised).toBe(true);
  });

  test('raises both caps and re-arms only above current spend', () => {
    const blocked = _apply({
      command: { action: 'raise-both', amount: 1, force: false },
      current: { softCap: 5, hardCap: 5 },
      spend: 6,
    });
    const open = _apply({
      command: { action: 'raise-both', amount: 2, force: false },
      current: { softCap: 5, hardCap: 5 },
      spend: 6,
    });

    expect(blocked.rearmHard).toBe(false);
    expect(blocked.rearmSoft).toBe(false);
    expect(blocked.hardAtOrBelowSpend).toBe(true);
    expect(open.after).toEqual({ softCap: 7, hardCap: 7 });
    expect(open.rearmHard).toBe(true);
    expect(open.rearmSoft).toBe(true);
  });

  test('re-arms a raised soft cap only when spend is below it', () => {
    const current = { softCap: 1, hardCap: 15 };
    expect(
      _apply({
        command: { action: 'set-soft', amount: 2, force: false },
        current,
        spend: 1,
      }).rearmSoft,
    ).toBe(true);
    expect(
      _apply({
        command: { action: 'set-soft', amount: 2, force: false },
        current,
        spend: 2,
      }).rearmSoft,
    ).toBe(false);
  });
});

describe('budget ceiling', () => {
  test('allows changing the soft cap beneath an existing hard cap above the ceiling', () => {
    const change = _apply({
      command: { action: 'set-soft', amount: 20, force: false },
      current: { softCap: 10, hardCap: 300 },
      ceiling: 200,
    });

    expect(change.after).toEqual({ softCap: 20, hardCap: 300 });
  });

  test('requires force to set a hard cap above the ceiling', () => {
    const command = { action: 'set-hard', amount: 300, force: false } as const;
    const rejected = applyBudgetCommand({
      command,
      current: { softCap: 10, hardCap: 15 },
      defaults: { softCap: 10, hardCap: 15 },
      ceiling: 200,
      spend: 0,
    });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      throw new Error('Expected ceiling rejection');
    }
    expect(rejected.error).toContain('--force');
  });

  test('allows an explicitly forced hard cap above the ceiling', () => {
    const change = _apply({
      command: { action: 'set-hard', amount: 300, force: true },
      ceiling: 200,
    });

    expect(change.after.hardCap).toBe(300);
  });
});

describe('budget session persistence', () => {
  test('round-trips the latest cap snapshot on the active branch', () => {
    const manager = SessionManager.inMemory();
    manager.appendCustomEntry(
      BUDGET_ENTRY_TYPE,
      createPersistedBudget({ softCap: 20, hardCap: 25 }),
    );
    manager.appendCustomEntry(
      BUDGET_ENTRY_TYPE,
      createPersistedBudget({ softCap: 30, hardCap: 35 }),
    );

    expect(findPersistedBudget(manager.getBranch())).toEqual({ softCap: 30, hardCap: 35 });
  });

  test('restores persisted usage totals when a session resumes', () => {
    const manager = SessionManager.inMemory();
    manager.appendUsage('test', 'provider', 'model', {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 0,
      totalTokens: 60,
      cost: { input: 0.04, output: 0.05, cacheRead: 0.03, cacheWrite: 0, total: 0.12 },
    });
    manager.appendUsage('test', 'provider', 'model', {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0.03, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.08 },
    });

    expect(restoreSessionSpend(manager.getBranch())).toBeCloseTo(0.2);
  });
});
