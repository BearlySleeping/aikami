// packages/backend/configs/src/lib/app.ts
import {
  type AppOptions,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { logger } from '$logger';
import {
  backendEnv,
  getMode,
  getProjectId,
  isEmulatorMode,
  isRunningOnCloudRun,
} from './environment.ts';

/**
 * Parses the Firebase service account JSON string and fixes private key newlines.
 */
const parseServiceAccount = (serviceAccountString: string): ServiceAccount => {
  try {
    // 1. Decode Base64 if necessary
    let jsonString = serviceAccountString;
    if (!serviceAccountString.trim().startsWith('{')) {
      jsonString = Buffer.from(serviceAccountString, 'base64').toString('utf-8');
    }

    // 2. THE FIX: Convert literal line breaks back into escaped \n text
    // This prevents the "Unterminated string in JSON" error
    jsonString = jsonString.replace(/\r?\n/g, '\\n');
    // 3. Now it is safe to parse
    const parsed = JSON.parse(jsonString) as ServiceAccount;

    // 4. Firebase Admin SDK actually *needs* literal newlines in the private key,
    // so we convert them back after parsing the JSON object.
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
  const projectId = getProjectId();

  if (isEmulator) {
    return getEmulatorOptions(projectId);
  }

  const isCloudRun = isRunningOnCloudRun();

  const serviceAccountString = isCloudRun ? undefined : backendEnv.FIREBASE_SERVICE_ACCOUNT;
  logger.info('isCloudRun', isCloudRun);

  // 🚨 THE FIX: Strip leaked GitHub Actions paths so they don't hijack native ADC
  if (isCloudRun && process.env.GOOGLE_APPLICATION_CREDENTIALS?.includes('/home/runner/')) {
    logger.warn('Detected leaked CI credential path. Deleting it to force native Cloud Run ADC.');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  if (serviceAccountString) {
    logger.info('- Initializing Firebase Admin SDK with service account');
    options.credential = cert(parseServiceAccount(serviceAccountString));
  } else {
    logger.info('- Initializing Firebase Admin SDK without service account (relying on ADC)');
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

  logger.info('- Firebase Admin SDK projectId', {
    projectId: options.projectId,
    hasCredential: !!options.credential,
    // biome-ignore lint/style/useNamingConvention: temp debugging
    hasGOOGLE_APPLICATION_CREDENTIALS: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
    googleApplicationCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    isCloudRun: isRunningOnCloudRun(),
    isEmulator: isEmulatorMode(),
    mode: getMode(),
  });

  const initializedApp = initializeApp(options);

  logger.info('- Firebase Admin SDK initialized!', {
    appName: initializedApp.name,
    optionsProjectId: options.projectId,
  });

  return initializedApp;
};
