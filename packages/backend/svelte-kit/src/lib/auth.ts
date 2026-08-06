import { deleteCookie, getCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import { verifyIdToken, verifySessionCookie } from '@aikami/backend/utils/auth';
import { toUserSessionDataFromToken } from '@aikami/backend/utils/auth.ts';
import { REDIRECT_TO_URL_SEARCH_PARAM_KEY } from '@aikami/constants';
import type { UserSessionData } from '@aikami/types';
import type { Cookies } from '@sveltejs/kit';
import { logger } from '$logger';

// Minimal FirebaseError interface to avoid importing firebase-admin in frontend builds
type FirebaseError = { code: string; message?: string };

export const getUserSessionFromLocales = (options: {
  locals: { userSession?: UserSessionData };
}): UserSessionData | undefined => {
  const { locals } = options;
  if (locals.userSession?.userRole) {
    return locals.userSession;
  }
  return;
};

export const getUserSessionFromIdToken = async (
  token: string,
): Promise<[UserSessionData] | [undefined, boolean]> => {
  try {
    logger.debug('getUserSessionFromIdToken', { hasToken: !!token });

    const decodedIdToken = await verifyIdToken(token, true /** checkRevoked */);
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

/**
 * Extracts the current user session from the __session cookie.
 * Returns the user session data, or undefined if not logged in.
 * Also returns shouldReAuthenticate=true when the session cookie exists but
 * is revoked/expired (the client should re-fetch via Firebase Auth SDK).
 */
export const getUserSessionFromCookies = async (options: {
  cookies: Cookies;
  url: URL;
  request: Request;
  domain?: string;
}): Promise<[UserSessionData] | [undefined, boolean]> => {
  try {
    const sessionCookie = getCookie('__session', options);
    logger.debug('getUserSessionFromCookies', { hasCookie: !!sessionCookie });

    if (!sessionCookie || sessionCookie === 'null' || sessionCookie === 'undefined') {
      return [undefined, false];
    }

    const decodedIdToken = await verifySessionCookie(sessionCookie, true /** checkRevoked */);
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

/**
 * Convenience wrapper: calls getUserSessionFromCookies and catches errors,
 * returning just { userSession, shouldReAuthenticate }.
 */
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

    // ── JWT in search param (for E2E testing with emulator) ──
    if (process.env.AIKAMI_MODE === 'emulator') {
      const jwtParam = url.searchParams.get('jwt');
      if (jwtParam) {
        const [userSessionFromJwt, shouldReAuth] = await getUserSessionFromIdToken(jwtParam);
        logger.log('getUserSession:jwt', {
          hasSession: !!userSessionFromJwt,
          role: userSessionFromJwt?.userRole,
        });
        if (userSessionFromJwt) {
          return { userSession: userSessionFromJwt, shouldReAuthenticate: shouldReAuth };
        }
      }
    }

    const [userSession, shouldReAuthenticate] = await getUserSessionFromCookies(options);

    logger.log('getUserSession', {
      href: url.href,
      hasSearchParams: url.searchParams.size > 0,
      shouldReAuthenticate,
      hasSession: !!userSession,
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

export const getUserSessionFromLocalesOrURL = async (options: {
  locals: { userSession?: UserSessionData };
  cookies: Cookies;
  url: URL;
  request: Request;
}): Promise<UserSessionData | undefined> => {
  logger.log('getUserSessionFromLocalesOrURL', {
    hasLocalsSession: !!options.locals.userSession,
    url: options.url.pathname,
  });
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
  logger.log('getUserSessionFromLocalesOrURL:idTokenHeader', {
    hasIdToken: !!idToken,
    idTokenPrefix: idToken ? `${idToken.slice(0, 20)}...` : undefined,
  });

  if (idToken) {
    const [userSessionFromIdToken] = await getUserSessionFromIdToken(idToken);

    logger.log('getUserSessionFromLocalesOrURL:idTokenResult', {
      hasSession: !!userSessionFromIdToken,
      role: userSessionFromIdToken?.userRole,
    });

    if (userSessionFromIdToken) {
      locals.userSession = userSessionFromIdToken;
      return locals.userSession;
    }
  }

  if (userSession?.userRole) {
    return locals.userSession;
  }

  logger.log('getUserSessionFromLocalesOrURL:returningUndefined', {
    hadLocalsSession: !!locals.userSession,
    localsUserRole: locals.userSession?.userRole,
    hadIdToken: !!options.request.headers.get('firebase-auth-id-token'),
  });

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

    const decodedIdToken = await verifyIdToken(token, true /** checkRevoked */);
    return toUserSessionDataFromToken(decodedIdToken);
  } catch (error) {
    logger.error('getUserFromTokenHeader', error);
    return;
  }
};
