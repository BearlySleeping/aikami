import { getAuth } from '@aikami/backend/configs/auth.ts';
import { deleteCookie, getCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import { toUserSessionDataFromToken } from '@aikami/backend/utils/auth.ts';
import { REDIRECT_TO_URL_SEARCH_PARAM_KEY } from '@aikami/constants';
import type { UserSessionData } from '@aikami/types';
import { type Cookies, redirect } from '@sveltejs/kit';
import type { FirebaseError } from 'firebase-admin';
import { logger } from '$logger';
import { toRouteHref } from '$router';

/**
 * Same as {@link getUserSession} but redirects to login page if user is not
 * logged in, or register page is user don't have userRole
 *
 * @param options - Request event
 * @returns User session data
 */
export const validateUserSession = (options: {
  url: URL;
  locals: { userSession?: UserSessionData };
}): UserSessionData => {
  const { url } = options;
  const userSession = getUserSessionFromLocales(options);
  logger.log('validateUserSession', { userSession });

  if (!userSession) {
    logger.log('validateUserSession: no userSession', {
      path: url.pathname,
      userSession,
    });
    redirect(
      307,
      toRouteHref('login', {
        pathParameters: undefined,
        queryParameters: undefined,
        setRedirectTo: true,
        url,
      }),
    );
  }
  if (!userSession.userRole) {
    logger.log('validateUserSession: no userRole');
    redirect(
      307,
      toRouteHref('register', {
        pathParameters: undefined,
        queryParameters: undefined,
        setRedirectTo: true,
        url,
      }),
    );
  }

  // if (userSession.status === 'unconfirmed-terms') {
  // 	logger.log('validateUserSession: user has not confirm terms', {
  // 		path: url.pathname,
  // 		userSession,
  // 	});
  // 	redirect(
  // 		307,
  // 		toRouteHref({
  // 			pathParameters: undefined,
  // 			queryParameters: undefined,
  // 			// TODO add authenticate
  // 			route: 'authenticate',
  // 			setRedirectTo: true,
  // 			url,
  // 		}),
  // 	);
  // }

  return userSession;
};

export const getUserSessionFromLocales = (options: {
  locals: { userSession?: UserSessionData };
}): UserSessionData | undefined => {
  const { locals } = options;
  if (locals.userSession?.userRole) {
    return locals.userSession;
  }
  return;
};

export const getUserSessionFromLocalesOrURL = async (options: {
  locals: { userSession?: UserSessionData };
  cookies: Cookies;
  url: URL;
  request: Request;
}): Promise<UserSessionData | undefined> => {
  logger.log('getUserSessionFromLocalesOrURL', options);
  const { locals } = options;
  let userSession = locals.userSession;
  if (!userSession) {
    const { userSession: userSessionFromCookies } = await getUserSession(options);
    logger.log('getUserSessionFromLocalesOrURL:userSessionFromCookies', {
      userSessionFromCookies,
    });
    userSession = userSessionFromCookies;
    if (userSession) {
      locals.userSession = userSession;
    }
  }

  if (userSession?.userRole) {
    return locals.userSession;
  }

  const idToken = options.request.headers.get('firebase-auth-id-token');
  if (idToken) {
    const [userSessionFromIdToken] = await getUserSessionFromIdToken(idToken);

    if (userSessionFromIdToken) {
      locals.userSession = userSessionFromIdToken;
      return locals.userSession;
    }
  }

  if (userSession?.userRole) {
    return locals.userSession;
  }

  return;
};

export const getSearchParamValue = (options: {
  searchParams: URLSearchParams;
  key: string;
}): string | undefined => {
  const { key, searchParams } = options;
  let value = searchParams.get(key);
  if (value) {
    return value;
  }

  const goToPath = searchParams.get(REDIRECT_TO_URL_SEARCH_PARAM_KEY);
  if (!goToPath) {
    return;
  }
  // make goToPath a valid URLSearchParams, it will be
  // be like this goto=%2Fcrm%2Fadd...
  const goToSearchParams = new URLSearchParams(goToPath);
  value = goToSearchParams.get(key);
  return value ?? undefined;
};

export const getUserSession = async (options: {
  cookies: Cookies;
  url: URL;
  request: Request;
  domain?: string;
}): Promise<{
  userSession: UserSessionData | undefined;
  shouldReAuthenticate?: boolean | undefined;
}> => {
  try {
    const { url } = options;

    const [userSession, shouldReAuthenticate] = await getUserSessionFromCookies(options);
    logger.log('getUserSession', {
      href: url.href,
      searchParams: url.searchParams,
      shouldReAuthenticate,
      userSession,
    });

    return {
      shouldReAuthenticate,
      userSession,
    };
  } catch (error) {
    logger.error('hooks.server:getUserSession', error);
    return {
      shouldReAuthenticate: false,
      userSession: undefined,
    };
  }
};

export const getUserSessionFromIdToken = async (
  token: string,
): Promise<[UserSessionData] | [undefined, boolean]> => {
  try {
    logger.debug('getUserSessionFromIdToken', { token });

    const decodedIdToken = await getAuth().verifyIdToken(token, true /** checkRevoked */);
    return [toUserSessionDataFromToken(decodedIdToken)];
  } catch (e) {
    const error = e as FirebaseError;
    const code = error.code;

    const refreshTokenErrorCodes = [
      'auth/id-token-revoked',
      'auth/id-token-expired',
      'auth/argument-error',
    ];
    const shouldTryToRefreshToken = refreshTokenErrorCodes.includes(code);

    logger.error('getUserSessionFromIdToken', error);
    return [undefined, shouldTryToRefreshToken];
  }
};

export const getUserSessionFromCookies = async (options: {
  cookies: Cookies;
  url: URL;
  request: Request;
  domain?: string;
}): Promise<[UserSessionData] | [undefined, boolean]> => {
  try {
    const sessionCookie = getCookie('__session', options);
    logger.debug('getUserSessionFromCookies', { sessionCookie });

    if (!sessionCookie || sessionCookie === 'null' || sessionCookie === 'undefined') {
      return [undefined, false];
    }

    const decodedIdToken = await getAuth().verifySessionCookie(
      sessionCookie,
      true /** checkRevoked */,
    );
    return [toUserSessionDataFromToken(decodedIdToken)];
  } catch (e) {
    const error = e as FirebaseError;
    const code = error.code;

    const refreshTokenErrorCodes = [
      'auth/id-token-revoked',
      'auth/id-token-expired',
      'auth/argument-error',
    ];
    const shouldTryToRefreshToken = refreshTokenErrorCodes.includes(code);

    deleteCookie('__session', options);

    logger.error('getUserSessionFromCookies', error);
    return [undefined, shouldTryToRefreshToken];
  }
};

export const getUserFromTokenHeader = async (options: {
  headers: Headers;
}): Promise<UserSessionData | undefined> => {
  try {
    const { headers } = options;
    const authorizationHeader = headers.get('Authorization');
    if (!authorizationHeader) {
      return undefined;
    }
    const [type, token] = authorizationHeader.split(' ');
    if (type !== 'Bearer') {
      return undefined;
    }
    if (!token) {
      return undefined;
    }

    const decodedIdToken = await getAuth().verifyIdToken(token, true /** checkRevoked */);
    return toUserSessionDataFromToken(decodedIdToken);
  } catch (error) {
    logger.error('getUserFromTokenHeader', error);
    return;
  }
};
