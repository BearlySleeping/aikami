import type {
  Auth,
  AuthCredential as FirebaseAuthCredential,
  AuthProvider as FirebaseAuthProvider,
  User,
  UserCredential as FirebaseAuthUserCredential,
  UserInfo as FirebaseUserInfo,
} from '@firebase/auth'
import type { z } from 'zod'
import type { FirebaseAuthMetadataSchema } from '@aikami/schemas'

export type {
  FirebaseAuthCredential,
  FirebaseAuthProvider,
  FirebaseAuthUserCredential,
  FirebaseUserInfo,
}

export type FirebaseUser = User
export type FirebaseAuth = Auth

export type FirebaseAuthMetadata = z.infer<typeof FirebaseAuthMetadataSchema>

export type FirebaseAuthErrorCode = 'auth/user-not-found' | string
