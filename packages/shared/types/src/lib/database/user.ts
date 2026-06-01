// packages/shared/types/src/lib/database/user.ts
import type {
  UserCreateSchema,
  UserLiteCreateSchema,
  UserLiteSchema,
  UserSchema,
  UserSessionSchema,
  UserUpdateSchema,
} from '@aikami/schemas';
import type { Type } from 'typebox';
import type { SignInProvider } from '../auth.ts';

export type CurrentUser = CurrentUserData | CurrentUserLiteData | CurrentUserSessionData;

export type CurrentUserData = UserData & {
  currentSignInProvider?: SignInProvider;
  fetchedUserData: true;
};

export type CurrentUserLiteData = UserLiteData & {
  fetchedUserData?: true;
};

export type CurrentUserSessionData = UserSessionData & {
  fetchedUserData?: true;
};
export type UserCreateData = Type.Static<typeof UserCreateSchema>;

export type UserData = Type.Static<typeof UserSchema>;

export type UserLiteCreateData = Type.Static<typeof UserLiteCreateSchema>;
export type UserLiteData = Type.Static<typeof UserLiteSchema>;

export type UserSessionData = Type.Static<typeof UserSessionSchema>;

export type UserUpdateData = Type.Static<typeof UserUpdateSchema>;
