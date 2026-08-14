// packages/shared/types/src/lib/local_ai/stack_backend.ts

import type { StackBackendSchema, StackModalitySchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type StackBackend = Static<typeof StackBackendSchema>;
export type StackModality = Static<typeof StackModalitySchema>;
