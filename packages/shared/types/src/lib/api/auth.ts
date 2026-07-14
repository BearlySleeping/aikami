// packages/shared/types/src/lib/api/auth.ts
import type {
  Auth,
  AuthCredential as FirebaseAuthCredential,
  AuthProvider as FirebaseAuthProvider,
  UserCredential as FirebaseAuthUserCredential,
  UserInfo as FirebaseUserInfo,
  User,
} from 'firebase/auth';

export type { FirebaseAuthMetadata } from '@aikami/schemas';
export type {
  FirebaseAuthCredential,
  FirebaseAuthProvider,
  FirebaseAuthUserCredential,
  FirebaseUserInfo,
};

export type FirebaseUser = User;
export type FirebaseAuth = Auth;

export type FirebaseAuthErrorCode = 'auth/user-not-found' | string;
