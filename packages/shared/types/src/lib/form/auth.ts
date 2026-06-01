// packages/shared/types/src/lib/form/auth.ts
import type { RegisterFormSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type RegisterForm = Type.Static<typeof RegisterFormSchema>;
