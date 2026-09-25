// .pi/extensions/lib/budget_state.ts
//
// Pure command parsing, cap transitions, persistence validation, and session
// spend restoration for cost_guard.ts. No pi runtime, environment, clock, or
// mutable global state is read here.

import type { SessionEntry } from '@earendil-works/pi-coding-agent';

/** Session-entry type used to persist the latest interactive cap override. */
export const BUDGET_ENTRY_TYPE = 'cost-guard-budget' as const;

/** Default soft cap when PI_SOFT_SPEND is unset or invalid. */
export const DEFAULT_SOFT_CAP = 10 as const;

/** Default hard cap when PI_HARD_SPEND is unset or invalid. */
export const DEFAULT_HARD_CAP = 15 as const;

/** Default maximum cap a user may set without an explicit force flag. */
export const DEFAULT_SPEND_CEILING = 200 as const;

const USD_PATTERN = /^\$?(?:\d+(?:\.\d+)?|\.\d+)$/;
const DELTA_PATTERN = /^\+(?:\d+(?:\.\d+)?|\.\d+)$/;
const BUDGET_USAGE =
  'Usage: /budget, /budget soft <usd>, /budget hard <usd>, /budget +<usd>, or /budget reset.';

/** A validated soft/hard spend pair. */
export type BudgetCaps = {
  readonly softCap: number;
  readonly hardCap: number;
};

/** A command that changes the current cap pair. */
export type BudgetMutationCommand =
  | { readonly action: 'set-soft'; readonly amount: number; readonly force: boolean }
  | { readonly action: 'set-hard'; readonly amount: number; readonly force: boolean }
  | { readonly action: 'raise-both'; readonly amount: number; readonly force: boolean }
  | { readonly action: 'reset'; readonly force: boolean };

/** A complete parsed `/budget` invocation. */
export type BudgetCommand = { readonly action: 'show' } | BudgetMutationCommand;

/** Result of parsing a raw command argument string. */
export type BudgetParseResult =
  | { readonly ok: true; readonly command: BudgetCommand }
  | { readonly ok: false; readonly error: string };

/** Deterministic result of applying a valid mutation command. */
export type BudgetChange = {
  readonly before: BudgetCaps;
  readonly after: BudgetCaps;
  readonly rearmHard: boolean;
  readonly rearmSoft: boolean;
  readonly hardAutoRaised: boolean;
  readonly hardAtOrBelowSpend: boolean;
  readonly remainingHeadroom: number;
};

/** Result of applying a mutation command. */
export type BudgetChangeResult =
  | { readonly ok: true; readonly change: BudgetChange }
  | { readonly ok: false; readonly error: string };

/** Persisted custom-entry payload written after every successful change. */
export type PersistedBudget = {
  readonly version: 1;
  readonly softCap: number;
  readonly hardCap: number;
};

const _isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const _parseUsd = (raw: string): number | undefined => {
  if (!USD_PATTERN.test(raw)) {
    return undefined;
  }
  const amount = Number(raw.startsWith('$') ? raw.slice(1) : raw);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
};

const _parseDelta = (raw: string): number | undefined => {
  if (!DELTA_PATTERN.test(raw)) {
    return undefined;
  }
  const amount = Number(raw.slice(1));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
};

const _parseFailure = (message: string): BudgetParseResult => ({
  ok: false,
  error: `${message}. ${BUDGET_USAGE}`,
});

const _tokenizeArgs = (rawArgs: string): { tokens: string[]; force: boolean } => {
  const tokens = rawArgs.trim() ? rawArgs.trim().split(/\s+/) : [];
  const force = tokens[tokens.length - 1] === '--force';
  if (force) {
    tokens.pop();
  }
  return { tokens, force };
};

const _parseEmptyCommand = (force: boolean): BudgetParseResult =>
  force
    ? _parseFailure('/budget --force needs a budget action')
    : { ok: true, command: { action: 'show' } };

const _parseCapCommand = (options: {
  readonly command: 'soft' | 'hard';
  readonly tokens: string[];
  readonly force: boolean;
}): BudgetParseResult => {
  const value = options.tokens[1];
  if (options.tokens.length !== 2 || value === undefined) {
    return _parseFailure(`${options.command} needs one amount`);
  }
  const amount = _parseUsd(value);
  if (amount === undefined) {
    return _parseFailure(`${options.command} amount must be a finite number greater than zero`);
  }
  return {
    ok: true,
    command:
      options.command === 'soft'
        ? { action: 'set-soft', amount, force: options.force }
        : { action: 'set-hard', amount, force: options.force },
  };
};

const _parseRaiseCommand = (options: {
  readonly command: string;
  readonly tokens: string[];
  readonly force: boolean;
}): BudgetParseResult => {
  if (options.tokens.length !== 1) {
    return _parseFailure('Raise-both syntax accepts only one delta');
  }
  const amount = _parseDelta(options.command);
  if (amount === undefined) {
    return _parseFailure('Raise-both delta must be a finite number greater than zero');
  }
  return { ok: true, command: { action: 'raise-both', amount, force: options.force } };
};

const _parseResetCommand = (options: {
  readonly tokens: string[];
  readonly force: boolean;
}): BudgetParseResult =>
  options.tokens.length === 1
    ? { ok: true, command: { action: 'reset', force: options.force } }
    : _parseFailure('reset does not accept a value');

/** Enforce the invariant that a hard cap can never sit below its soft cap. */
const normalizeBudgetCaps = (caps: BudgetCaps): BudgetCaps => ({
  softCap: caps.softCap,
  hardCap: Math.max(caps.hardCap, caps.softCap),
});

/** Parse one human-entered `/budget` argument string without executing it. */
export const parseBudgetCommand = (rawArgs: string): BudgetParseResult => {
  const { tokens, force } = _tokenizeArgs(rawArgs);
  if (tokens.length === 0) {
    return _parseEmptyCommand(force);
  }

  const command = tokens[0] ?? '';
  if (command === 'soft' || command === 'hard') {
    return _parseCapCommand({ command, tokens, force });
  }
  if (command === 'reset') {
    return _parseResetCommand({ tokens, force });
  }
  if (command.startsWith('+')) {
    return _parseRaiseCommand({ command, tokens, force });
  }
  return _parseFailure(`Unknown budget action "${command}"`);
};

const _selectedCaps = (options: {
  readonly command: BudgetMutationCommand;
  readonly current: BudgetCaps;
  readonly defaults: BudgetCaps;
}): { readonly caps: BudgetCaps; readonly hardAutoRaised: boolean } => {
  const { command, current, defaults } = options;
  if (command.action === 'reset') {
    return { caps: normalizeBudgetCaps(defaults), hardAutoRaised: false };
  }
  if (command.action === 'set-soft') {
    return {
      caps: { softCap: command.amount, hardCap: Math.max(current.hardCap, command.amount) },
      hardAutoRaised: command.amount > current.hardCap,
    };
  }
  if (command.action === 'set-hard') {
    return {
      caps: { softCap: current.softCap, hardCap: Math.max(command.amount, current.softCap) },
      hardAutoRaised: command.amount < current.softCap,
    };
  }
  return {
    caps: {
      softCap: current.softCap + command.amount,
      hardCap: current.hardCap + command.amount,
    },
    hardAutoRaised: false,
  };
};

/** Apply a parsed mutation, including hard/soft ordering and ceiling policy. */
export const applyBudgetCommand = (options: {
  readonly command: BudgetMutationCommand;
  readonly current: BudgetCaps;
  readonly defaults: BudgetCaps;
  readonly ceiling: number;
  readonly spend: number;
}): BudgetChangeResult => {
  const selected = _selectedCaps(options);
  const after = normalizeBudgetCaps(selected.caps);
  if (
    options.command.action !== 'reset' &&
    after.hardCap > options.ceiling &&
    !options.command.force
  ) {
    return {
      ok: false,
      error:
        `Hard cap $${after.hardCap.toFixed(2)} exceeds the $${options.ceiling.toFixed(2)} ceiling. ` +
        'Repeat the command with --force to override it.',
    };
  }

  return {
    ok: true,
    change: {
      before: options.current,
      after,
      rearmHard: after.hardCap > options.current.hardCap && after.hardCap > options.spend,
      rearmSoft: after.softCap > options.current.softCap && after.softCap > options.spend,
      hardAutoRaised: selected.hardAutoRaised || after.hardCap > selected.caps.hardCap,
      hardAtOrBelowSpend: after.hardCap <= options.spend,
      remainingHeadroom: after.hardCap - options.spend,
    },
  };
};

/** Create the versioned payload stored in the session's active branch. */
export const createPersistedBudget = (caps: BudgetCaps): PersistedBudget => ({
  version: 1,
  softCap: caps.softCap,
  hardCap: caps.hardCap,
});

const _readPersistedBudget = (data: unknown): BudgetCaps | undefined => {
  if (!_isRecord(data) || data.version !== 1) {
    return undefined;
  }
  const softCap = data.softCap;
  const hardCap = data.hardCap;
  if (
    typeof softCap !== 'number' ||
    typeof hardCap !== 'number' ||
    !Number.isFinite(softCap) ||
    !Number.isFinite(hardCap) ||
    softCap <= 0 ||
    hardCap <= 0
  ) {
    return undefined;
  }
  return normalizeBudgetCaps({ softCap, hardCap });
};

/** Restore the latest valid cap snapshot from active-branch session entries. */
export const findPersistedBudget = (entries: readonly SessionEntry[]): BudgetCaps | undefined => {
  let latest: BudgetCaps | undefined;
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== BUDGET_ENTRY_TYPE) {
      continue;
    }
    const restored = _readPersistedBudget(entry.data);
    if (restored) {
      latest = restored;
    }
  }
  return latest;
};

const _storedUsageCost = (usage: unknown): number => {
  if (!_isRecord(usage) || !_isRecord(usage.cost)) {
    return 0;
  }
  const total = usage.cost.total;
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 0;
};

const _storedMessageCost = (message: unknown): number => {
  if (!_isRecord(message) || (message.role !== 'assistant' && message.role !== 'toolResult')) {
    return 0;
  }
  return _storedUsageCost(message.usage);
};

const _storedEntryCost = (entry: SessionEntry): number => {
  if (entry.type === 'message') {
    return _storedMessageCost(entry.message);
  }
  if (entry.type === 'usage') {
    return _storedUsageCost(entry.usage);
  }
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return _storedUsageCost(entry.usage);
  }
  return 0;
};

/**
 * Restore authoritative session spend from persisted usage totals.
 *
 * Current Pi sessions persist `usage.cost.total` for assistant calls, tool or
 * summary calls, compaction, and branch summaries. Summing the active branch
 * prevents reload/resume from resetting the spend guard. Older entries without
 * a persisted total are intentionally skipped rather than repriced with the
 * wrong historical model.
 */
export const restoreSessionSpend = (entries: readonly SessionEntry[]): number =>
  entries.reduce((total, entry) => total + _storedEntryCost(entry), 0);
