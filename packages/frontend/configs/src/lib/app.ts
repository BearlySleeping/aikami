// packages/frontend/configs/src/lib/app.ts
import { toAppError } from '@aikami/utils';
import { type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { logger } from '$logger';
import { publicEnv, isEmulatorMode } from './environment';

const getApp = () => {
  const app = getApps()[0];
  if (app) {
    return app;
  }

  const projectId = publicEnv.PUBLIC_FIREBASE_PROJECT_ID;

  const serviceAccount: FirebaseOptions = isEmulatorMode()
    ? {
        apiKey: 'demo-key',
        authDomain: 'localhost',
        projectId,
        storageBucket: `${projectId}.firebasestorage.app`,
        messagingSenderId: '000000000000',
        appId: 'demo-app-id',
        measurementId: 'test-measurement-id',
      }
    : {
        apiKey: publicEnv.PUBLIC_FIREBASE_API_KEY,
        authDomain: publicEnv.PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: publicEnv.PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: publicEnv.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: publicEnv.PUBLIC_FIREBASE_APP_ID,
        measurementId: publicEnv.PUBLIC_FIREBASE_MEASUREMENT_ID,
      };

  if (!serviceAccount.apiKey) {
    throw toAppError(
      'internal',
      'Firebase configuration is missing. Set required environment variables like PUBLIC_FIREBASE_API_KEY.',
    );
  }

  logger.info('Initializing Firebase app', { projectId });
  const initializedApp = initializeApp(serviceAccount);
  return initializedApp;
};

const app = getApp();

export default app;
