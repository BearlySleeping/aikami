// packages/frontend/configs/src/lib/app_check.ts
import {
  type AppCheck,
  getToken,
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'firebase/app-check';
import { logger } from '$logger';
import app from './app.ts';
import { getPublicMode, publicEnv } from './environment';

const initializeAppCheckInstance = (): AppCheck | undefined => {
  try {
    const {
      PUBLIC_DISABLE_APP_CHECK: disableAppCheck,
      PUBLIC_RECAPTCHA_SITE_KEY: recaptchaSiteKey,
    } = publicEnv;
    const isDisabled = disableAppCheck === '1';
    const mode = getPublicMode();
    const isNonProductionMode = mode && mode !== 'production';

    // Disable App Check for non-production modes when the debug token
    // isn't registered in the Firebase Console (otherwise exchangeDebugToken
    // returns 403 and cascades to break Firebase Auth entirely).
    if (isDisabled || isNonProductionMode) {
      if (isNonProductionMode && !isDisabled) {
        logger.info(
          `App Check disabled for mode "${mode}". ` +
            'Set PUBLIC_DISABLE_APP_CHECK=0 and register the debug token in Firebase Console to enable it.',
        );
      }
      return;
    }

    if (!recaptchaSiteKey) {
      if (!import.meta.env.DEV) {
        logger.warn(
          'No PUBLIC_RECAPTCHA_SITE_KEY set. Using Google test key — App Check will NOT work against production Firebase. Set a real key for production deployments.',
        );
      }
    }

    return initializeAppCheck(app, {
      isTokenAutoRefreshEnabled: true,
      provider: new ReCaptchaV3Provider(
        recaptchaSiteKey || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
      ),
    });
  } catch (error) {
    logger.warn('Failed to initialize app check', error);
    return;
  }
};

export const appCheck = initializeAppCheckInstance();

/**
 * Retrieves the current App Check token.
 * Useful for including in manual fetch requests to protected backends.
 */
export const getAppCheckToken = async () => {
  if (!appCheck) {
    return;
  }

  const token = await getToken(appCheck);
  return token;
};
