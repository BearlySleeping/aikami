// packages/frontend/services/src/lib/firebase/configs/app.ts
import { toAppError } from '@aikami/utils';
import { type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { logger } from '$logger';

const getApp = () => {
  const app = getApps()[0];
  if (app) {
    return app;
  }

  const isEmulator = import.meta.env.PUBLIC_FLAVOR === 'EMULATOR';
  const projectId = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID;

  const serviceAccount: FirebaseOptions = isEmulator
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
        apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
        authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
      };

  if (!serviceAccount.apiKey) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Firebase configuration is missing. Please set the required environment variables like `PUBLIC_FIREBASE_API_KEY`.',
    });
  }
  // TODO: change to debug
  logger.info('serviceAccount', serviceAccount);
  const initializedApp = initializeApp(serviceAccount);
  logger.info('- app initialized', initializedApp);
  return initializedApp;
};

// https://gist.github.com/dyaa/8f8d1f8964160630f2475fe26a2e6150
const app = getApp();

// const getAppCheck = () => {
// 	try {
// 		if (import.meta.env['PUBLIC_DISABLE_APP_CHECK'] === '1') {
// 			return;
// 		}

// 		const recaptchaSiteKey = import.meta.env[
// 			'PUBLIC_RECAPTCHA_SITE_KEY'
// 		] as string | undefined;
// 		if (!recaptchaSiteKey) {
// 			throw toAppError(
// 				'internal',
// 				'No reCAPTCHA v3 site key found. Please set the environment variable `PUBLIC_RECAPTCHA_SITE_KEY`.',
// 			);
// 		}

// 		if (import.meta.env.DEV) {
// 			(
// 				self as Window &
// 					typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: true }
// 			).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
// 		}

// 		// Pass your reCAPTCHA v3 site key (public key) to activate(). Make sure this
// 		// key is the counterpart to the secret key you set in the Firebase console.
// 		return initializeAppCheck(app, {
// 			// Optional argument. If true, the SDK automatically refreshes App Check
// 			// tokens as needed.
// 			isTokenAutoRefreshEnabled: true,

// 			provider: new ReCaptchaV3Provider(recaptchaSiteKey),
// 		});
// 	} catch (error) {
// 		// void logger.warn('Failed to initialize app check', error);

// 		return;
// 	}
// };

// export const appCheck = getAppCheck();

export default app;
