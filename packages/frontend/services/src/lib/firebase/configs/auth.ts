import { connectAuthEmulator, getAuth } from 'firebase/auth';
import app from './app.ts';

export {
  confirmPasswordReset as firebaseConfirmPasswordReset,
  createUserWithEmailAndPassword,
  GithubAuthProvider,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  getIdToken,
  OAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateEmail,
  updatePassword as firebaseUpdatePassword,
  updateProfile,
  verifyPasswordResetCode as firebaseVerifyPasswordResetCode,
} from 'firebase/auth';

export const auth = getAuth(app);

if (import.meta.env.PUBLIC_FLAVOR === 'EMULATOR') {
  connectAuthEmulator(auth, 'http://localhost:9099');
}
