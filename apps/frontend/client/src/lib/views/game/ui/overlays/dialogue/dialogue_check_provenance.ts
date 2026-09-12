// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_check_provenance.ts
//
// Skill-check provenance helpers. The dialogue ViewModel records each check as
// a durable operation before its presentation begins and settles it from the
// authoritative roll — so an interrupted check is recovered as
// pending/interrupted rather than silently rerolled (design §8, verification #9).
//
// Evidence that has no rules authority (the dice result is local and already
// decided) still must not be lost, so the operation is opened before the spin
// animation and closed after the narrative resolution call.

import type { BeginGameOperationOptions, GameOperation } from '@aikami/types';

/** The narrow operation-ledger surface the check flow needs. */
export type DialogueOperationCapabilities = {
  begin(options: BeginGameOperationOptions): Promise<GameOperation>;
  complete(operationId: string, result?: unknown): Promise<void>;
  fail(operationId: string, error: string): Promise<void>;
};

/** The authoritative facts of one skill check. */
export type SkillCheckProvenance = {
  checkId: string;
  checkType: string;
  difficultyClass: number;
  natural: number;
  total: number;
  isSuccess: boolean;
};

/**
 * Opens a `pending` skill-check operation before presentation. Returns
 * undefined when there is no campaign to scope it to (e.g. a dev sandbox).
 */
export const beginSkillCheckOperation = async (options: {
  operations: DialogueOperationCapabilities;
  campaignId: string | undefined;
  conversationId: string;
  check: SkillCheckProvenance;
}): Promise<string | undefined> => {
  if (!options.campaignId) {
    return undefined;
  }
  const operation = await options.operations.begin({
    kind: 'skill_check',
    campaignId: options.campaignId,
    conversationId: options.conversationId,
    checkId: options.check.checkId,
    request: options.check,
  });
  return operation.operationId;
};

/** Settles a check operation as completed with its authoritative roll. */
export const completeSkillCheckOperation = async (options: {
  operations: DialogueOperationCapabilities;
  operationId: string | undefined;
  check: SkillCheckProvenance;
}): Promise<void> => {
  if (!options.operationId) {
    return;
  }
  await options.operations.complete(options.operationId, options.check);
};

/** Settles a check operation as failed with a reason. */
export const failSkillCheckOperation = async (options: {
  operations: DialogueOperationCapabilities;
  operationId: string | undefined;
  error: string;
}): Promise<void> => {
  if (!options.operationId) {
    return;
  }
  await options.operations.fail(options.operationId, options.error);
};
