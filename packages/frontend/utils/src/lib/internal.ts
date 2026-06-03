import type { ErrorType, SvelteKitError } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';

export type APICalls = Record<string, [unknown, unknown]>;

export const callSvelteKitAPI = async <
  AllFunctions extends APICalls,
  Endpoint extends keyof AllFunctions,
>(
  endpoint: Endpoint,
  request: AllFunctions[Endpoint][0],
  idToken?: string,
): Promise<AllFunctions[Endpoint][1]> => {
  const callEndpoint = endpoint as string;

  // const appCheckToken = await getAppCheckToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // if (appCheckToken) {
  // 	headers['X-Firebase-AppCheck'] = appCheckToken;
  // }

  if (idToken) {
    headers['firebase-auth-id-token'] = idToken;
  }

  const init: RequestInit = {
    body: JSON.stringify(request ?? {}),
    headers,
    method: 'POST',
  };

  logger.debug('callSvelteKitAPI', { endpoint, ...init });

  const response = await fetch(`/api/${callEndpoint}`, init);
  logger.debug('callSvelteKitAPI:response', response);

  const body = await response.json();
  if (response.status !== 200) {
    const svelteKitError = body as SvelteKitError;
    logger.error(`Error calling endpoint ${`/api/${callEndpoint}`}`, body);

    throw toAppError({
      errorType: svelteKitError.type as ErrorType,
      errorMessage: svelteKitError.message ?? 'Unknown error',
      details: svelteKitError.details,
    });
  }
  const { response: responseData } = body as {
    response: AllFunctions[Endpoint][1];
  };

  return responseData;
};

// let _getAppCheckToken:
// 	| typeof import('./firebase/app-check').getAppCheckToken
// 	| undefined;

// const getAppCheckToken = async (): Promise<string | undefined> => {
// 	try {
// 		if (!_getAppCheckToken) {
// 			const { getAppCheckToken } = await import('./firebase/app-check');
// 			_getAppCheckToken = getAppCheckToken;
// 		}
// 		const response = await _getAppCheckToken();
// 		return response?.token;
// 	} catch (error) {
// 		logger.warn('Failed to get app check token', error);
// 		const flavorsToIgnore = ['production', 'staging']; // TODO: Remove this when app check works in all flavors
// 		if (
// 			!flavorsToIgnore.includes(
// 				import.meta.env['PUBLIC_FLAVOR'] as string,
// 			)
// 		) {
// 			throw toAppError(
// 				'captcha-invalid',
// 				'Failed to get app check token',
// 			);
// 		}
// 		return;
// 	}
// };
