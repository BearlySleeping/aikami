// packages/frontend/configs/src/lib/auth.ts
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import type { FrontendAppId } from '@aikami/schemas';
import app from './app.ts';
import { EMULATOR_PORTS, isEmulatorModePublic, publicEnv } from './environment.ts';

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

/**
 * Dev-server port per app that serves the `/emulator/auth` proxy to the
 * Firebase Auth emulator. The Auth SDK is pointed at the app's own origin
 * so popup, redirect and iframe-relay endpoints all share one origin.
 *
 * Apps without a dev-server port (e.g. docs) don't use Firebase Auth and
 * are skipped. `client-tauri` reuses the client web dev server (and its
 * auth proxy) because the Tauri shell loads the same client bundle.
 */
const APP_AUTH_EMULATOR_PORTS: Partial<Record<FrontendAppId, number>> = {
  client: EMULATOR_PORTS.client,
  'client-tauri': EMULATOR_PORTS.client,
  site: EMULATOR_PORTS.site,
  hub: EMULATOR_PORTS.hub,
};

const initializeAuthInstance = (): Auth => {
  const instance = getAuth(app);

  if (isEmulatorModePublic()) {
    const emulatorPort = APP_AUTH_EMULATOR_PORTS[publicEnv.PUBLIC_APP_ID];
    if (emulatorPort) {
      // Point the Firebase Auth SDK at the app's own origin so all auth
      // endpoints (popup, redirect, iframe relay) share the same origin.
      // The app's vite dev server proxies /emulator/auth → the actual
      // Auth emulator (port 9098).
      connectAuthEmulator(instance, `http://localhost:${emulatorPort}`, {
        disableWarnings: true,
      });
    }
  }

  return instance;
};

export const auth = initializeAuthInstance();
