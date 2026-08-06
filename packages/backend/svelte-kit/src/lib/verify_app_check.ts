import { getAppCheck } from '@aikami/backend/configs/app_check';
import { toAppError, toAppErrorFromUnknownError } from '@aikami/utils';
import { logger } from '$logger';

export const verifyAppCheck = async (request: { headers: Headers }) => {
  try {
    const appCheckToken = request.headers.get('X-Firebase-AppCheck');
    if (!appCheckToken) {
      throw toAppError({ errorType: 'captcha-required', errorMessage: 'Missing app check token' });
    }

    await getAppCheck().verifyToken(appCheckToken);
    logger.log('verifyAppCheck:valid');
  } catch (error) {
    const appError = toAppErrorFromUnknownError(error);
    if (appError.cause.errorType !== 'internal') {
      // Already classified (e.g. captcha-required) — preserve it.
      throw error;
    }

    logger.error('verifyAppCheck:error', error);
    throw toAppError({
      details: error,
      errorType: 'internal',
      errorMessage: 'Failed to verify app check token',
    });
  }
};
