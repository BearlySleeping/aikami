// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `User` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const UserRowSchema = Type.Object({
  id: Type.String({ description: "Primary key. Holds the Firebase Auth uid — see ID STRATEGY above. @default(expr: \"auth.uid\") is a server-side fallback; Admin SDK writes must set id explicitly (auth.uid is null outside a client request)." }),
  createdAt: Type.String({ format: 'date-time', description: "Server-set on insert; updates must pass updatedAt_expr: \"request.time\"." }),
  updatedAt: Type.String({ format: 'date-time' }),
  displayName: Type.Optional(Type.String({ description: "Auth / profile fields" })),
  email: Type.Optional(Type.String({ description: "Case-insensitive uniqueness: Postgres @unique is case-sensitive, so the sync layer must normalize emails to lowercase before persistence (writes that would insert a differently-cased duplicate are rejected at the database boundary). Multiple NULLs stay legal (absent emails are allowed)." })),
  photoURL: Type.Optional(Type.String()),
  phoneNumber: Type.Optional(Type.String()),
  role: Type.Union([Type.Literal('MEMBER'), Type.Literal('SUPER_ADMIN')]),
  firstName: Type.Optional(Type.String({ description: "Optional profile details" })),
  lastName: Type.Optional(Type.String()),
  countryCode: Type.Optional(Type.String()),
  localeCode: Type.Optional(Type.String()),
  connectedEmails: Type.Optional(Type.Unknown({ description: "Connected Google accounts. Shape validated by UserSchema in packages/shared/schemas/src/lib/firestore/user.ts (connectedEmails: Optional(Array(String)))." })),
  signInProviders: Type.Optional(Type.Unknown({ description: "Sign-in providers used by this account. Shape validated by UserSchema in packages/shared/schemas/src/lib/firestore/user.ts; provider vocabulary from SignInProviderSchema in packages/shared/schemas/src/lib/auth/auth.ts ('email' | 'google' | 'github')." })),
  agreedAt: Type.Optional(Type.String({ format: 'date-time', description: "Terms acceptance timestamp." })),
  monthlyUploadedDuration: Type.Optional(Type.Number({ description: "Aggregate counter." })),
});

export type UserRowData = Type.Static<typeof UserRowSchema>;
export type UserRow = Type.Static<typeof UserRowSchema>;