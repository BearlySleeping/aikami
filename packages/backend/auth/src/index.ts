// packages/backend/auth/src/index.ts
//
// C-426: auth is served entirely by Better Auth (session cookie, backed by
// D1). The legacy Firebase Auth callable path (register, checkUniqueEmail,
// updateEmail, deleteAccount, sendResetPassword, createCustomFirebaseSignInToken,
// completeDeviceHandoff) was removed — Better Auth's device-authorization
// plugin replaces the custom-token device flow.

export type { BetterAuthEnv, BetterAuthInstance } from './lib/better_auth.ts';

export { betterAuthSchema, createBetterAuth, toUserSessionData } from './lib/better_auth.ts';
