// packages/shared/types/src/lib/api/auth.ts
//
// Auth types for the Better Auth stack. Firebase Auth has been removed
// (C-426); these are structural types with no firebase SDK import.

export type { AuthMetadata } from '@aikami/schemas';

/** A Better Auth session user (the subset the app consumes). */
export type AuthUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

/** A Better Auth session (user + session). */
export type AuthSession = {
  user: AuthUser;
  session: { id: string; expiresAt: string | Date };
};
