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
    connectAuthEmulator(instance, `http://localhost:${EMULATOR_PORTS.auth}`);
  }

  return instance;
};

export const auth = initializeAuthInstance();
