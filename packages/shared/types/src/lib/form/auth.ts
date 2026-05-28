import type { RegisterFormSchema } from '@aikami/schemas';
import type { z } from 'zod';

export type RegisterForm = z.infer<typeof RegisterFormSchema>;
