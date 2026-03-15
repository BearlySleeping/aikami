import {
  type AppOptions,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { logger } from '$logger';
import { getEnvironmentValue } from './environment.ts';

/**
 * Determines if the application is currently running in emulator mode.
 * Checks multiple sources: process.env, and vite mode.
 */
export const isEmulatorMode = (): boolean => {
  // Check vite mode (set via --mode flag or vite.config.ts)
  const viteMode = getEnvironmentValue('VITE_MODE', true) || getEnvironmentValue('NODE_ENV', true);
  if (viteMode === 'emulator') {
    return true;
  }

  return (
    !!getEnvironmentValue('FIRESTORE_EMULATOR_HOST', true) ||
    getEnvironmentValue('FLAVOR') === 'EMULATOR'
  );
};

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

/**
 * Builds the configuration options for the Firebase Admin SDK based on the environment.
 */
const buildAppOptions = (isEmulator: boolean): AppOptions => {
  const options: AppOptions = {};

  // The Firebase Auth emulator requires a projectId to validate tokens.
  const projectId = getEnvironmentValue('GCP_PROJECT_ID', true);

  if (isEmulator) {
    logger.debug(
      '- Running in emulator mode. Setting projectId to satisfy Admin SDK requirements.',
    );
    options.projectId = projectId;
    return options;
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

  const isEmulator = isEmulatorMode();
  logger.log('isEmulator', isEmulator);

  const options = buildAppOptions(isEmulator);

  logger.debug(`- Initializing Firebase Admin SDK with options`, options);
  const initializedApp = initializeApp(options);
  logger.debug('- Firebase Admin SDK initialized!');

  return initializedApp;
};
