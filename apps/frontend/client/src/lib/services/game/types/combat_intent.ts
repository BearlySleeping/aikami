// apps/frontend/client/src/lib/services/game/types/combat_intent.ts
//
// Request contract of the natural-language combat intent interpreter (C-525 AC-2).
//
// It lives here rather than in `combat_intent_service.svelte.ts` because the
// client service-conventions guard (S10) requires a `*_service.svelte.ts` file to
// export nothing but its own `*ServiceOptions` / `*ServiceInterface` types.
//
// Contract: C-525 AC-2

import type { CombatState } from '@aikami/types';

/** One interpretation request; the caller mints and owns the correlation id. */
export type CombatIntentRequest = {
  /** Client-minted correlation id — cancellation and staleness are keyed to it. */
  requestId: string;
  /** Client-minted intent id (travels into the compiled plan). */
  intentId: string;
  encounterId: string;
  actorId: string;
  /** The `CombatState.stateRevision` the text was authored against. */
  basedOnRevision: number;
  /** Verbatim player text. Untrusted; bounded here. */
  text: string;
  /** Live snapshot used ONLY to build the legal, visible context. */
  state: CombatState;
};
