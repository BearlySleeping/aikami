import type { Cookies } from '@sveltejs/kit';
import { logger } from '$logger';

// The original, public-facing CookieKey type.
export type CookieKey = '__session' | 'locale' | 'sessionId';

/**
 * The internal shape of the data stored within the __session cookie. The
 * 'session' key is reserved for the Firebase Auth JWT.
 */
type SessionStore = {
  locale?: string;
  sessionId?: string;
  session?: string;
};

export type SerializeOptions = Parameters<Cookies['set']>[2];

// Your original baseCookieOptions, unchanged.
export const baseCookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: true,
} as const satisfies SerializeOptions;

export const sessionAge = 60 * 60 * 24 * 14 * 1000; // 14 days

// Your original getCorrectDomain function, unchanged.
const getCorrectDomain = (options: { domain?: string; request: Request; url: URL }): string => {
  if (options.domain) {
    return options.domain;
  }
  const forwardedHost = options.request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const hosts = forwardedHost.split(',');
    if (hosts[0]) {
      return hosts[0].trim();
    }
  }
  return options.url.hostname;
};

/**
 * Internal helper to safely read and parse the __session cookie.
 *
 * @param cookies The SvelteKit cookies object.
 * @returns The parsed SessionStore object, or an empty object if none exists.
 */
const getStore = (cookies: Cookies): SessionStore => {
  const cookieValue = cookies.get('__session');
  if (!cookieValue) {
    return {};
  }

  try {
    const data = JSON.parse(cookieValue);
    if (typeof data === 'object' && data !== null) {
      return data as SessionStore;
    }
    return { session: cookieValue };
  } catch (_error) {
    return { session: cookieValue };
  }
};

/**
 * Internal helper to safely stringify and save the SessionStore to the
 * __session cookie.
 *
 * @param cookies The SvelteKit cookies object.
 * @param data The SessionStore object to save.
 * @param domain The domain for the cookie.
 */
const saveStore = (cookies: Cookies, data: SessionStore, domain: string) => {
  if (Object.keys(data).length === 0) {
    cookies.delete('__session', { ...baseCookieOptions, domain });
    return;
  }

  const stringifiedData = JSON.stringify(data);

  if (stringifiedData.length > 3800) {
    logger.warn('Cookie size is nearing the 4KB limit!', {
      size: stringifiedData.length,
    });
  }

  cookies.set('__session', stringifiedData, {
    ...baseCookieOptions,
    domain,
    maxAge: sessionAge,
  });
};

/**
 * Gets a value from the session store.
 *
 * @param key The key of the cookie to retrieve.
 * @param options The options object containing the cookies object.
 * @returns The value from the session store.
 */
export const getCookie = (key: CookieKey, options: { cookies: Cookies }): string | undefined => {
  const store = getStore(options.cookies);
  const value = key === '__session' ? store.session : store[key];

  // The original signature expects a string, so we convert for consistency,
  // though the actual value could be a boolean.
  return value !== undefined ? String(value) : undefined;
};

/**
 * Sets a value in the session store, preserving the original signature.
 *
 * @param key The key of the cookie to set.
 * @param value The value to set.
 * @param options The options object containing the cookies object.
 */
export const setCookie = (
  key: CookieKey,
  value: string,
  options: {
    cookies: Cookies;
    domain?: string;
    maxAge?: number;
    request: Request;
    url: URL;
  },
): void => {
  const { cookies, request, url } = options;
  const domain = getCorrectDomain({ domain: options.domain, request, url });
  const store = getStore(cookies);

  if (key === '__session') {
    store.session = value;
  } else {
    store[key] = value;
  }

  logger.debug('setCookie (in store)', { domain, key });
  saveStore(cookies, store, domain);
};

/**
 * Deletes a value from the session store, preserving the original signature.
 *
 * @param key The key of the cookie to delete.
 * @param options The options object containing the cookies object.
 */
export const deleteCookie = (
  key: CookieKey,
  options: {
    cookies: Cookies;
    domain?: string;
    request: Request;
    url: URL;
  },
): void => {
  const { cookies, request, url } = options;
  const domain = getCorrectDomain({ domain: options.domain, request, url });
  const store = getStore(cookies);

  if (key === '__session') {
    delete store.session;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete store[key];
  }

  logger.log('deleteCookie (from store)', { domain, key });
  saveStore(cookies, store, domain);
};
