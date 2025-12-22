import type {
  UserCreateSchema,
  UserLiteCreateSchema,
  UserLiteSchema,
  UserSchema,
  UserSessionSchema,
  UserUpdateSchema,
} from '@aikami/schemas'
import type { z } from 'zod'
import type { SignInProvider } from '../auth.ts'

export type CurrentUser =
  | CurrentUserData
  | CurrentUserLiteData
  | CurrentUserSessionData

export type CurrentUserData = UserData & {
  currentSignInProvider?: SignInProvider
  fetchedUserData: true
}

export type CurrentUserLiteData = UserLiteData & {
  fetchedUserData?: true
}

export type CurrentUserSessionData = UserSessionData & {
  fetchedUserData?: true
}
export type UserCreateData = z.infer<typeof UserCreateSchema>

export type UserData = z.infer<typeof UserSchema>

export type UserLiteCreateData = z.infer<typeof UserLiteCreateSchema>
export type UserLiteData = z.infer<typeof UserLiteSchema>

export type UserSessionData = z.infer<typeof UserSessionSchema>

export type UserUpdateData = z.infer<typeof UserUpdateSchema>
