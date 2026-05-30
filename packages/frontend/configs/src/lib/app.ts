// packages/frontend/configs/src/lib/app.ts
import { type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { logger } from '$logger';
import { getProjectId, publicEnv } from './environment';

const getApp = () => {
  const app = getApps()[0];
  if (app) {
    return app;
  }

  const {
    PUBLIC_FIREBASE_API_KEY: apiKey,
    PUBLIC_FIREBASE_AUTH_DOMAIN: authDomain,
    PUBLIC_FIREBASE_STORAGE_BUCKET: storageBucket,
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID: messagingSenderId,
    PUBLIC_FIREBASE_APP_ID: appId,
    PUBLIC_FIREBASE_MEASUREMENT_ID: measurementId,
  } = publicEnv;

  const projectId = getProjectId();

  // All Firebase config values come from .env files — validated by masterSchema.
  const serviceAccount: FirebaseOptions = {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId,
  };
  // TODO: change to debug
  logger.info('serviceAccount', serviceAccount);
  const initializedApp = initializeApp(serviceAccount);
  logger.info('- app initialized', initializedApp);

  return initializedApp;
};

// https://gist.github.com/dyaa/8f8d1f8964160630f2475fe26a2e6150
const app = getApp();

// Kick off App Check eagerly alongside the app.
// Needs to be dynamic import to avoid circular dependency on 'app' (app_check.ts
// imports app from here). The dynamic import fires as a microtask after
// synchronous module evaluation, and the ES module cache guarantees app is
// fully initialised by then — no race condition with lazy-loaded services.
//
// Why App Check init lives here (not in a separately imported module):
// All Firebase services (auth, functions, firestore, storage, etc.) are
// lazy-loaded via dynamic import() in the service layer — there is no single
// "bootstrap" or init function that centralises Firebase setup. The only
// module guaranteed to be evaluated early is this one (the Firebase app
// singleton). App Check must be initialised once, early, alongside the
// Firebase app, so that all subsequent Firebase SDK calls (Functions, Auth,
// Storage) automatically attach App Check tokens.
void import('./app_check.ts');

export default app;
