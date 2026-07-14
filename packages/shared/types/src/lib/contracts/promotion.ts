// packages/shared/types/src/lib/contracts/promotion.ts

import type { PromotionStateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type PromotionState = Type.Static<typeof PromotionStateSchema>;
