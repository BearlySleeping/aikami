// packages/shared/types/src/lib/game/party.ts
//
// Party and companion types — derived from @aikami/schemas via Static<>.
//
// Contract: C-340 Build Party and Companion Gameplay

import type { PartyRosterEntrySchema, PartyStateSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type PartyRosterEntry = Static<typeof PartyRosterEntrySchema>;
export type PartyState = Static<typeof PartyStateSchema>;
export type FormationType = PartyState['formation'];
