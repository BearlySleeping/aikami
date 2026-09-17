// packages/frontend/engine/src/combat/combat_command_envelope.ts
//
// One command-admission envelope for every ordinary v2 command (review F2/F-B).
//
// Before this module, only reactions carried identity: an ordinary move /
// action / interact / end-turn could be delivered late, after a retry, or twice
// and the resolver would still resolve it against whatever revision happened to
// be live. `basedOnRevision` was optional and the main-thread forwarder dropped
// it entirely, so the fix did not hold at the production seam.
//
// This module is the single admission boundary:
//
//   proposal → preview → ADMISSION → kernel resolution → accepted transition
//
// Admission verifies encounter identity, execution-run identity, the expected
// revision, the turn identity and engine-derived actor ownership BEFORE the
// kernel is reached, and it implements command-ID idempotency:
//
//   same commandId + same canonical content  → the original outcome, no re-resolve
//   same commandId + different content       → typed conflict, no re-resolve
//
// The accepted-command journal it maintains is also the replay input: each
// entry records the exact kernel `CombatCommand` that was admitted, so
// `replayCombat` can reconstruct the encounter from the initial state without
// provider calls.
//
// Contract: C-525 AC-4, C-532 AC-4/AC-6

import type { CombatCommand, CombatInvalidReason, CombatState } from '@aikami/types';
import { canonicalCombatJson } from '@aikami/utils';
import type { World } from 'bitecs';

/** Bounded identity carried by every ordinary v2 command. */
export type CombatCommandIdentity = {
  /** Unique per command attempt; the idempotency key. */
  commandId: string;
  /** The authored encounter the command belongs to. */
  encounterId: string;
  /** The execution run the command was confirmed against. */
  encounterRunId: string;
  /** The acting stable combatant id (authored, never an eid). */
  combatantId: string;
  /** The turn identity the command was confirmed on (`CombatState.turnId`). */
  turnId: string;
  /** The committed revision the command was confirmed against. */
  basedOnRevision: number;
};

/**
 * The wire shape of the identity block on a bridge command.
 *
 * Every field is optional at the TYPE level only because the legacy engine
 * shares these command variants. The v2 dispatcher REQUIRES all of them and
 * rejects a v2 command that omits any — see {@link admitV2Command}.
 */
export type CombatCommandIdentityFields = {
  commandId?: string;
  encounterId?: string;
  encounterRunId?: string;
  combatantId?: string;
  turnId?: string;
  basedOnRevision?: number;
};

/** Why an ordinary v2 command was not admitted. */
export type CommandAdmissionRejection =
  | 'missingCommandIdentity'
  | 'encounterMismatch'
  | 'encounterRunMismatch'
  | 'staleRevision'
  | 'staleTurn'
  | 'actorMismatch'
  | 'actorNotOwned'
  | 'commandIdConflict';

/**
 * The stable i18n reason code each admission rejection maps onto. The precise
 * cause travels separately as {@link CommandAdmissionResult.detail} so the
 * message catalog does not need a new key for every admission failure.
 */
export const COMMAND_ADMISSION_REASON_CODE: Record<CommandAdmissionRejection, CombatInvalidReason> =
  {
    missingCommandIdentity: 'invalidCommandShape',
    // The command names an encounter that is not the one running: for this
    // command that encounter is over. Distinct detail, stable reason code.
    encounterMismatch: 'encounterEnded',
    encounterRunMismatch: 'encounterRunMismatch',
    staleRevision: 'staleRevision',
    staleTurn: 'staleRevision',
    actorMismatch: 'notActiveCombatant',
    actorNotOwned: 'notActiveCombatant',
    commandIdConflict: 'invalidCommandShape',
  };

/** One admitted command, recorded for idempotency and replay. */
export type CombatCommandJournalEntry = {
  commandId: string;
  /** Canonical content digest — the idempotency comparison key. */
  digest: string;
  /** The exact normalized kernel command that was admitted. */
  command: CombatCommand;
  /** The revision the command was admitted against. */
  previousRevision: number;
  /** The revision the command produced, or `null` when it was rejected. */
  resultRevision: number | null;
  outcome: 'accepted' | 'rejected';
  /** Present when `outcome === 'rejected'`. */
  reasonCode?: CombatInvalidReason;
};

/** The serializable journal cursor + entries persisted with a save. */
export type CombatCommandJournal = {
  /** Entries evicted from the front of the journal (bounded retention). */
  droppedCount: number;
  entries: CombatCommandJournalEntry[];
};

/** Maximum retained journal entries per encounter (bounded memory + save size). */
export const COMBAT_COMMAND_JOURNAL_MAX_ENTRIES = 2048;

/** The outcome of admitting one command. */
export type CommandAdmissionResult =
  | { status: 'admitted'; identity: CombatCommandIdentity; digest: string }
  | {
      status: 'duplicate';
      identity: CombatCommandIdentity;
      /** The original journal entry — never re-resolved. */
      entry: CombatCommandJournalEntry;
    }
  | {
      status: 'rejected';
      rejection: CommandAdmissionRejection;
      reasonCode: CombatInvalidReason;
      detail: string;
    };

type JournalStore = {
  entries: CombatCommandJournalEntry[];
  byCommandId: Map<string, CombatCommandJournalEntry>;
  droppedCount: number;
};

const journals = new WeakMap<World, Map<string, JournalStore>>();

const storeFor = (world: World, encounterId: string, create: boolean): JournalStore | undefined => {
  let byEncounter = journals.get(world);
  if (byEncounter === undefined) {
    if (!create) {
      return undefined;
    }
    byEncounter = new Map<string, JournalStore>();
    journals.set(world, byEncounter);
  }
  const existing = byEncounter.get(encounterId);
  if (existing !== undefined) {
    return existing;
  }
  if (!create) {
    return undefined;
  }
  const created: JournalStore = { entries: [], byCommandId: new Map(), droppedCount: 0 };
  byEncounter.set(encounterId, created);
  return created;
};

/**
 * Canonical digest of a command's mechanical content.
 *
 * Identity fields (commandId, encounter, run, revision) are deliberately
 * EXCLUDED: the digest answers "is this the same command?", and the identity
 * answers "is this the same attempt?". Two attempts at the same command
 * legitimately share a digest but never a commandId.
 */
export const combatCommandDigest = (command: CombatCommand): string =>
  canonicalCombatJson(command);

/** The serializable journal for one encounter, or `null` when none exists. */
export const getCombatCommandJournal = (world: World, encounterId: string): CombatCommandJournal | null => {
  const store = storeFor(world, encounterId, false);
  if (store === undefined) {
    return null;
  }
  return { droppedCount: store.droppedCount, entries: store.entries.map((entry) => ({ ...entry })) };
};

/** Restores a journal from a save. Replaces any existing journal for the encounter. */
export const restoreCombatCommandJournal = (options: {
  world: World;
  encounterId: string;
  journal: CombatCommandJournal;
}): void => {
  const store = storeFor(options.world, options.encounterId, true);
  if (store === undefined) {
    return;
  }
  store.entries = options.journal.entries.slice(-COMBAT_COMMAND_JOURNAL_MAX_ENTRIES);
  store.droppedCount = options.journal.droppedCount;
  store.byCommandId = new Map(store.entries.map((entry) => [entry.commandId, entry]));
};

/** Forgets one encounter's journal (encounter teardown / retry / test isolation). */
export const clearCombatCommandJournal = (world: World, encounterId: string): void => {
  journals.get(world)?.delete(encounterId);
};

/** Forgets every journal for a world (teardown / test isolation). */
export const clearAllCombatCommandJournals = (world: World): void => {
  journals.delete(world);
};

/** The accepted commands in order — the replay input for this encounter. */
export const acceptedCommandsForReplay = (world: World, encounterId: string): CombatCommand[] => {
  const store = storeFor(world, encounterId, false);
  if (store === undefined) {
    return [];
  }
  return store.entries
    .filter((entry) => entry.outcome === 'accepted')
    .map((entry) => structuredClone(entry.command));
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Verifies one ordinary v2 command's identity against the authoritative state.
 *
 * Order matters: identity and freshness are checked BEFORE any content digest
 * or journal write, and the caller only reaches the kernel after `admitted`.
 * A rejection therefore spends no budget, consumes no RNG, emits no event,
 * mutates no ECS component and schedules no AI turn.
 */
export const admitV2Command = (options: {
  world: World;
  /** The live authoritative state the command would resolve against. */
  state: CombatState;
  /** The identity block carried by the bridge command. */
  identity: CombatCommandIdentityFields;
  /** The normalized kernel command the identity describes. */
  command: CombatCommand;
  /** Whether the engine's policy owns `identity.combatantId`. */
  isActorEngineControlled: boolean;
}): CommandAdmissionResult => {
  const { world, state, identity } = options;

  if (
    !isNonEmptyString(identity.commandId) ||
    !isNonEmptyString(identity.encounterId) ||
    !isNonEmptyString(identity.encounterRunId) ||
    !isNonEmptyString(identity.combatantId) ||
    !isNonEmptyString(identity.turnId) ||
    typeof identity.basedOnRevision !== 'number'
  ) {
    return reject('missingCommandIdentity');
  }

  const resolved: CombatCommandIdentity = {
    commandId: identity.commandId,
    encounterId: identity.encounterId,
    encounterRunId: identity.encounterRunId,
    combatantId: identity.combatantId,
    turnId: identity.turnId,
    basedOnRevision: identity.basedOnRevision,
  };

  const digest = combatCommandDigest(options.command);
  const store = storeFor(world, state.encounterId, true);
  const prior = store?.byCommandId.get(resolved.commandId);

  // Idempotency is decided on the command id ALONE and before freshness: a
  // duplicate delivery of an already-accepted command must return the original
  // outcome even though the live revision has since moved past it.
  if (prior !== undefined) {
    if (prior.digest !== digest) {
      return reject('commandIdConflict');
    }
    return { status: 'duplicate', identity: resolved, entry: { ...prior } };
  }

  if (resolved.encounterId !== state.encounterId) {
    return reject('encounterMismatch');
  }
  if (resolved.encounterRunId !== state.encounterRunId) {
    return reject('encounterRunMismatch');
  }
  if (resolved.basedOnRevision !== state.stateRevision) {
    return reject('staleRevision');
  }
  if (resolved.turnId !== (state.turnId ?? '')) {
    return reject('staleTurn');
  }
  if (resolved.combatantId !== (state.initiative.order[state.initiative.activeIndex] ?? '')) {
    return reject('actorMismatch');
  }
  if (!options.isActorEngineControlled) {
    return reject('actorNotOwned');
  }

  return { status: 'admitted', identity: resolved, digest };

  function reject(rejection: CommandAdmissionRejection): CommandAdmissionResult {
    return {
      status: 'rejected',
      rejection,
      reasonCode: COMMAND_ADMISSION_REASON_CODE[rejection],
      detail: rejection,
    };
  }
};

/**
 * Records the outcome of one admitted command.
 *
 * Called with the resolver's result so a duplicate delivery can be answered
 * from the journal instead of resolving a second time (which would re-roll the
 * dice and re-spend the budget).
 */
export const recordCommandOutcome = (options: {
  world: World;
  encounterId: string;
  identity: CombatCommandIdentity;
  digest: string;
  command: CombatCommand;
  previousRevision: number;
  resultRevision: number | null;
  outcome: 'accepted' | 'rejected';
  reasonCode?: CombatInvalidReason;
}): void => {
  const store = storeFor(options.world, options.encounterId, true);
  if (store === undefined || store.byCommandId.has(options.identity.commandId)) {
    return;
  }
  const entry: CombatCommandJournalEntry = {
    commandId: options.identity.commandId,
    digest: options.digest,
    command: structuredClone(options.command),
    previousRevision: options.previousRevision,
    resultRevision: options.resultRevision,
    outcome: options.outcome,
    ...(options.reasonCode === undefined ? {} : { reasonCode: options.reasonCode }),
  };
  store.entries.push(entry);
  store.byCommandId.set(entry.commandId, entry);
  while (store.entries.length > COMBAT_COMMAND_JOURNAL_MAX_ENTRIES) {
    const evicted = store.entries.shift();
    if (evicted === undefined) {
      break;
    }
    store.byCommandId.delete(evicted.commandId);
    store.droppedCount += 1;
  }
};

/** The journal entry for one command id, or `null`. Used for replay diagnostics. */
export const findCommandJournalEntry = (
  world: World,
  encounterId: string,
  commandId: string,
): CombatCommandJournalEntry | null => {
  const entry = storeFor(world, encounterId, false)?.byCommandId.get(commandId);
  return entry === undefined ? null : { ...entry };
};
