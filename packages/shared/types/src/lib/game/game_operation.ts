// packages/shared/types/src/lib/game/game_operation.ts
//
// Re-exports from @aikami/schemas — source of truth for the durable game
// operation record (derived via Static<> in the schema module).
// Contract: docs/design/game_ui_hud_overhaul.md — operation provenance

import type { GameOperationKind } from '@aikami/schemas';

export type {
  GameOperation,
  GameOperationKind,
  GameOperationStatus,
} from '@aikami/schemas';

/**
 * Input for beginning a durable operation. The request payload is opaque audit
 * data; the ledger never derives rules authority from it.
 */
export type BeginGameOperationOptions = {
  kind: GameOperationKind;
  campaignId: string;
  /** JSON-serializable audit payload describing the request. */
  request?: unknown;
  conversationId?: string;
  turnId?: string;
  checkId?: string;
  sourceEventId?: string;
};
