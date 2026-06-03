// packages/shared/types/src/lib/api/auth.ts
import type { FirebaseAuthMetadataSchema } from '@aikami/schemas';
import type {
  Auth,
  AuthCredential as FirebaseAuthCredential,
  AuthProvider as FirebaseAuthProvider,
  UserCredential as FirebaseAuthUserCredential,
  UserInfo as FirebaseUserInfo,
  User,
} from 'firebase/auth';
import type { Type } from 'typebox';

export type {
  FirebaseAuthCredential,
  FirebaseAuthProvider,
  FirebaseAuthUserCredential,
  FirebaseUserInfo,
};

export type FirebaseUser = User;
export type FirebaseAuth = Auth;

export type FirebaseAuthMetadata = Type.Static<typeof FirebaseAuthMetadataSchema>;

export type FirebaseAuthErrorCode = 'auth/user-not-found' | string;
