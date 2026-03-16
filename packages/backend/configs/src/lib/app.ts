// packages/backend/configs/src/lib/app.ts
import {
  type AppOptions,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { logger } from '$logger';
import { getEnvironmentValue, isEmulatorMode } from './environment.ts';

/**
 * Parses the Firebase service account JSON string and fixes private key newlines.
 */
const parseServiceAccount = (serviceAccountString: string): ServiceAccount => {
  try {
    const parsed = JSON.parse(serviceAccountString) as ServiceAccount;
    if (parsed.privateKey) {
      parsed.privateKey = parsed.privateKey.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch (error) {
    logger.error('Invalid FIREBASE_SERVICE_ACCOUNT env:', serviceAccountString);
    throw error;
  }
};

const getEmulatorOptions = (projectId: string): AppOptions => {
  logger.debug('- Running in emulator mode. Setting projectId to satisfy Admin SDK requirements.');

  // Set emulator hosts for Firebase Admin SDK
  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  process.env.GCLOUD_PROJECT = projectId;

  return { projectId, storageBucket: `${projectId}.firebasestorage.app` };
};

/**
 * Builds the configuration options for the Firebase Admin SDK based on the environment.
 */
const buildAppOptions = (): AppOptions => {
  const isEmulator = isEmulatorMode();
  logger.log('isEmulator', isEmulator);

  const options: AppOptions = {};

  // The Firebase Auth emulator requires a projectId to validate tokens.
  // In emulator mode, this is optional and will default to 'aikami-dev'
  const projectId = getEnvironmentValue('GCLOUD_PROJECT', isEmulator);

  if (isEmulator && !projectId) {
    return getEmulatorOptions('aikami-dev');
  }

  if (isEmulator && projectId) {
    return getEmulatorOptions(projectId);
  }

  // --- Production / Live Environment Setup ---
  const serviceAccountString = getEnvironmentValue('FIREBASE_SERVICE_ACCOUNT', true);
  const isCloudRun = !!getEnvironmentValue('K_SERVICE', true);

  if (!isCloudRun && serviceAccountString) {
    logger.debug('- Initializing Firebase Admin SDK with service account');
    options.credential = cert(parseServiceAccount(serviceAccountString));
  } else {
    logger.debug('- Initializing Firebase Admin SDK without service account (relying on ADC)');
  }

  if (projectId && !isEmulator) {
    options.storageBucket = `${projectId}.firebasestorage.app`;
    options.projectId = projectId;
  }

  return options;
};

/**
 * Retrieves an existing Firebase Admin app or initializes a new one.
 */
export const getApp = () => {
  const existingApp = getApps()[0];
  // Early return if we already have a valid app instance
  if (existingApp) {
    return existingApp;
  }

  const options = buildAppOptions();

  logger.debug(`- Initializing Firebase Admin SDK with options`, {
    credentials: !!options.credential,
    ...options,
  });

  const initializedApp = initializeApp(options);

  logger.debug('- Firebase Admin SDK initialized!');

  return initializedApp;
};
