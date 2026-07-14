// packages/shared/types/src/lib/database/user.ts
//
// Schema-derived names re-exported with traditional Data suffix for backward compatibility.
// Hand-authored composite types (CurrentUser, etc.) remain here.

import type { User, UserLite, UserSession } from '@aikami/schemas';
import type { SignInProvider } from '../auth/auth.ts';

// ── Re-exports from schemas (source of truth) ───────────────────────────

export type {
  User as UserData,
  UserCreate as UserCreateData,
  UserLite as UserLiteData,
  UserLiteCreate as UserLiteCreateData,
  UserSession as UserSessionData,
  UserUpdate as UserUpdateData,
} from '@aikami/schemas';

// ── Hand-authored composite types ───────────────────────────────────────

export type CurrentUser = CurrentUserData | CurrentUserLiteData | CurrentUserSessionData;

export type CurrentUserData = User & {
  currentSignInProvider?: SignInProvider;
  fetchedUserData: true;
};

export type CurrentUserLiteData = UserLite & {
  fetchedUserData?: true;
};

export type CurrentUserSessionData = UserSession & {
  fetchedUserData?: true;
};
