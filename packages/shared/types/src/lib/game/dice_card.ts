// packages/shared/types/src/lib/game/dice_card.ts
//
// Dice card types — inferred from the shared TypeBox schema (single source of
// truth). Contract: C-421.

import type { DiceCardDataSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type DiceCardData = Static<typeof DiceCardDataSchema>;
