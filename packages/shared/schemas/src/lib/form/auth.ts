// packages/shared/schemas/src/lib/form/auth.ts
import Type from 'typebox';
import { SignInProviderSchema } from '../auth/auth.ts';

export const RegisterFormSchema = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 8 }),
  signInProvider: SignInProviderSchema,
  displayName: Type.String(),
  uid: Type.Optional(Type.String()),
});

export type RegisterForm = Type.Static<typeof RegisterFormSchema>;
