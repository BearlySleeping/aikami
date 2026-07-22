// packages/frontend/configs/src/lib/auth.ts
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import app from './app.ts';
import { EMULATOR_PORTS, isEmulatorModePublic } from './environment.ts';

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
  signInAnonymously,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updateEmail,
  updatePassword as firebaseUpdatePassword,
  updateProfile,
  verifyPasswordResetCode as firebaseVerifyPasswordResetCode,
} from 'firebase/auth';

const initializeAuthInstance = (): Auth => {
  const instance = getAuth(app);

  if (isEmulatorModePublic()) {
    // Point the Firebase Auth SDK at the app's own origin so all auth
    // endpoints (popup, redirect, iframe relay) share the same origin.
    // Vite proxies /emulator/auth → the actual Auth emulator (port 9098).
    connectAuthEmulator(instance, `http://localhost:${EMULATOR_PORTS.client}`, {
      disableWarnings: true,
    });
  }

  return instance;
};

export const auth = initializeAuthInstance();
