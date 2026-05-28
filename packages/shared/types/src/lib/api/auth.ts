import type { FirebaseAuthMetadataSchema } from '@aikami/schemas';
import type {
  Auth,
  AuthCredential as FirebaseAuthCredential,
  AuthProvider as FirebaseAuthProvider,
  UserCredential as FirebaseAuthUserCredential,
  UserInfo as FirebaseUserInfo,
  User,
} from '@firebase/auth';
import type { z } from 'zod';

export type {
  FirebaseAuthCredential,
  FirebaseAuthProvider,
  FirebaseAuthUserCredential,
  FirebaseUserInfo,
};

export type FirebaseUser = User;
export type FirebaseAuth = Auth;

export type FirebaseAuthMetadata = z.infer<typeof FirebaseAuthMetadataSchema>;

export type FirebaseAuthErrorCode = 'auth/user-not-found' | string;
