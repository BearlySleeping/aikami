// packages/shared/types/src/lib/local_ai/stack_plan.ts

import type { StackPlanSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type StackPlan = Static<typeof StackPlanSchema>;
export type StackPlanModel = StackPlan['models'][number];
