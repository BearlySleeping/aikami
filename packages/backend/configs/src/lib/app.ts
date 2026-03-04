import {
  type AppOptions,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import logger from '$logger';
import { getEnvironmentValue } from './environment.ts';

const parseServiceAccount = (serviceAccountString: string): ServiceAccount => {
  try {
    // The JSON parser will handle the \n characters correctly on its own.
    const parsed = JSON.parse(serviceAccountString) as ServiceAccount;
    // Fix the private key newlines
    if (parsed.privateKey) {
      parsed.privateKey = parsed.privateKey.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch (error) {
    logger.error('Invalid FIREBASE_SERVICE_ACCOUNT env:', serviceAccountString);
    throw error;
  }
};

const getApp = () => {
  const app = getApps()[0];
  if (app) {
    return app;
  }

  const serviceAccountString = getEnvironmentValue('FIREBASE_SERVICE_ACCOUNT', true);
  const isCloudRun = !!getEnvironmentValue('K_SERVICE', true);

  const options: AppOptions = {};

  if (!isCloudRun && serviceAccountString) {
    logger.debug('- Initializing Firebase Admin SDK with service account');
    options.credential = cert(parseServiceAccount(serviceAccountString));
  } else {
    logger.debug('- Initializing Firebase Admin SDK without service account');
  }

  const projectId = getEnvironmentValue('GCP_PROJECT_ID', true);

  if (projectId) {
    options.storageBucket = `${projectId}.firebasestorage.app`;
    options.projectId = projectId;
  }

  return initializeApp(options);
};

export { getApp };
