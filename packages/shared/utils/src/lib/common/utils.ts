import type { UniversalValue } from '@aikami/types';
import { logger } from '$logger';
import { toAppError } from './error.ts';

/**
 * Check if two arrays contains the exact same string values (can be random
 * order).
 *
 * @param arrayA Array A.
 * @param arrayB Array B.
 * @returns {boolean} The result.
 */
export const isEqualArray = <T>(arrayA?: T[], arrayB?: T[]): boolean => {
  if (!arrayA || !arrayB) {
    return arrayA === arrayB;
  }

  if (arrayA.length !== arrayB.length) {
    return false;
  }
  for (const tag of arrayA) {
    if (!arrayB.includes(tag)) {
      return false;
    }
  }
  for (const tag of arrayB) {
    if (!arrayA.includes(tag)) {
      return false;
    }
  }
  return true;
};

export const isNotUndefined = <T>(item: T | undefined): item is T => typeof item !== 'undefined';

export const textIncludesAll = (text: string, search: string[]): boolean =>
  search.every((searchItem) => text.includes(searchItem));

export const isObject = (item?: unknown): item is Record<string, unknown> =>
  !!item && typeof item === 'object' && !Array.isArray(item);

/**
 * Check if two objects contains the exact same key/value pairs (can be random
 * order).
 *
 * @param objectA Object A.
 * @param objectB Object B.
 * @returns The result.
 */
export const isEqualObject = (
  objectA?: Record<string, unknown>,
  objectB?: Record<string, unknown>,
): boolean => {
  if (!objectA || !objectB) {
    return objectA === objectB;
  }

  const keysA = Object.keys(objectA);
  const keysB = Object.keys(objectB);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    const valueA = objectA[key];
    const valueB = objectB[key];
    const areObjects = isObject(valueA) && isObject(valueB);
    if (areObjects && !isEqualObject(valueA, valueB)) {
      return false;
    }

    const areArrays = Array.isArray(valueA) && Array.isArray(valueB);
    if (areArrays && !isEqualArray(valueA, valueB)) {
      return false;
    }

    if (valueA !== valueB) {
      return false;
    }
  }

  return true;
};

export const getRandomId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

/**
 * Check if an object is empty (object === {})
 *
 * @param object The object.
 * @returns The result.
 */
export const isEmptyObject = (object: Record<string, unknown>): boolean =>
  Object.entries(object).length === 0 && object.constructor === Object;

/**
 * Returns true if a key is not unidentified/null
 *
 * @param item The item.
 * @returns The result.
 */
export const exists = (item: unknown): boolean => typeof item !== 'undefined' && item !== null;

/**
 * Shuffles an array
 *
 * @param array The array.
 * @returns The shuffled array.
 */
export const shuffle = <T>(array: T[]): T[] => {
  const shuffledArray = [...array];
  let m = shuffledArray.length;
  let t: T | undefined;
  let index = 0;

  // While there remain elements to shuffle…
  while (m) {
    // Pick a remaining element…
    index = Math.floor(Math.random() * m--);

    // And swap it with the current element.
    t = shuffledArray[m];
    const value = shuffledArray[index];
    if (value && t) {
      shuffledArray[m] = value;
      shuffledArray[index] = t;
    }
  }

  return shuffledArray;
};

export const debounce = <F extends (...args: Parameters<F>) => ReturnType<F>>(
  func: F,
  waitFor: number,
) => {
  let timeout: ReturnType<typeof setTimeout>;

  return (...args: Parameters<F>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), waitFor);
  };
};

/**
 * A method that has a timeout, if the timeout is exceeded, the fallback method
 * should be called
 *
 * @param options The options.
 */
export const timeoutMethod = async (options: {
  method: () => Promise<void>;
  fallbackMethod: () => Promise<void> | void;
  timeoutInMS: number;
}): Promise<void> => {
  const { fallbackMethod, method, timeoutInMS } = options;
  return await new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      await fallbackMethod();
      resolve();
    }, timeoutInMS);

    void method().then(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

/**
 * A helper function to wait for x amount of milliseconds.
 *
 * @param ms The wait time in milliseconds.
 * @returns {void}
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A helper function to wait for at least x amount of milliseconds, if the
 * promise is finished before amount of milliseconds it will wait.
 *
 * @param promise The promise to execute.
 * @param ms The minimum amount of time to wait in milliseconds.
 */
export const promiseWithMinDelay = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  const [response] = await Promise.all([promise, delay(ms)]);
  return response;
};

/**
 * Get current unix time in seconds
 *
 * @returns Current unix time in seconds
 */
export const getCurrentUnixTime = (): number => Math.round(Date.now() / 1000);
export const getDuration = (startTime: number): number =>
  Math.round((Date.now() - startTime) / 1000);

export const toFixedNumber = (number_: number, digits: number, base?: number): number => {
  const pow = (base ?? 10) ** digits;
  return Math.round(number_ * pow) / pow;
};

/**
 * Prepend `https://` to humanized URLs like `example.com` and `localhost`.
 *
 * @example import prependHttp from 'prepend-http';
 * prependHttp('example.com'); //=> 'https://example.com'
 * prependHttp('localhost', { https: false }); //=> 'http://localhost'
 * prependHttp('https://example.com'); //=> 'https://example.com'
 *
 * @param url - The URL to prepend `https://` to.
 * @returns The URL with `https://` prepended.
 */
export const prependHttp = (url: string, { https = false } = {}): string => {
  if (typeof url !== 'string') {
    throw new TypeError(`Expected \`url\` to be of type \`string\`, got \`${typeof url}\``);
  }

  url = url.trim();

  if (/^\.*\/|^(?!localhost)\w+?:/.test(url)) {
    return url;
  }

  return url.replace(/^(?!(?:\w+?:)?\/\/)/, https ? 'https://' : 'http://');
};

/**
 * Convert a number in between a min and max value
 *
 * @param value the number to convert
 * @param min the minimum value
 * @param max the maximum value
 * @returns the converted number
 */
export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Get duration from now in milliseconds
 *
 * @param startTime the start time in milliseconds
 * @returns the duration in milliseconds
 */
export const getDurationFromNow = (startTime: number): number => Date.now() - startTime;

/**
 * @param unixTimestamp the unix timestamp in seconds
 * @returns A date object
 */
export const getDateFromUnixTime = (unixTimestamp: number) => new Date(unixTimestamp * 1000);

export const daysToSeconds = (days: number) => days * 24 * 60 * 60;

export const getDaysFromNowInUnix = (days: number) => getCurrentUnixTime() + daysToSeconds(days);

export const getMonthsFromNowInUnix = (months: number) => {
  const now = new Date();
  now.setMonth(now.getMonth() + months);
  return Math.round(now.getTime() / 1000);
};

export const getPathFromURL = (url: string): string => {
  const urlParts = new URL(url);
  const pathname = urlParts.pathname;
  if (pathname.startsWith('/')) {
    return pathname.slice(1);
  }
  return urlParts.pathname;
};

export const getPathAndSearchParamsFromURL = (url: string): string => {
  const urlParts = new URL(url);
  const pathname = urlParts.pathname;
  const searchParams = urlParts.searchParams.toString();
  if (pathname.startsWith('/')) {
    return `${pathname.slice(1)}${searchParams ? `?${searchParams}` : ''}`;
  }
  return `${urlParts.pathname}${searchParams ? `?${searchParams}` : ''}`;
};

export const toPercentage = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Get the user's initials from their name
 *
 * @param name the user's name
 * @returns the user's initials
 */
export const toInitials = (name: string) => {
  const names = name.split(' ');

  const firstName = names[0];
  const lastName = names[names.length - 1];
  const firstInitial = firstName?.[0] ?? '';
  const lastInitial = lastName?.[0] ?? '';

  return `${firstInitial}${lastInitial}`;
};

export const toDisplayUsername = (options: {
  firstName?: string;
  lastName?: string;
  firstname?: string;
  lastname?: string;
  name?: string;
  email?: string;
  displayName?: string;
}): string => {
  const { email, firstName, firstname, lastName, lastname, name } = options;
  let displayName = options.displayName ?? name;

  if (displayName) {
    return displayName;
  }

  displayName = [firstName ?? firstname, lastName ?? lastname].filter(Boolean).join(' ');

  if (displayName) {
    return displayName;
  }

  if (email) {
    const emailParts = email.split('@');
    const name = emailParts[0];
    if (name) {
      // capitalize first letter
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return email;
  }

  return '';
};

/**
 * Chunk an array into smaller arrays
 *
 * @param array the array to chunk
 * @param chunkSize the size of the chunks
 * @returns the chunked array
 */
export const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
  const result = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    result.push(chunk);
  }
  return result;
};

/**
 * Returns a new object with only the specified keys from the input object.
 *
 * @param object - The input object.
 * @param keys - The keys to pick from the input object.
 * @returns A new object with only the specified keys from the input object.
 */
export const pickKeysFromObject = <T extends Record<string, unknown>>(
  object: T,
  keys: (keyof T)[],
): Pick<T, keyof T> => {
  const result = {} as Pick<T, keyof T>;
  for (const key of keys) {
    result[key] = object[key];
  }
  return result;
};

/**
 * Get url with search params.
 *
 * Useful for adding optionals params to a url.
 *
 * @example const url = getURLWithSearchParams('https://example.com', { foo:
 * 'bar', baz: undefined, }); // url = 'https://example.com?foo=bar'
 *
 * @param url the url
 * @param params the params
 * @returns the url with search params
 */

export const getURLWithSearchParams = <
  T extends Record<string, string | number | boolean | undefined> = Record<
    string,
    string | number | boolean | undefined
  >,
>(
  url: string,
  params: T,
): string => {
  const urlObject = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      urlObject.searchParams.append(key, value.toString());
    }
  }

  return urlObject.toString();
};

export const getRawURLWithSearchParams = <
  T extends Record<string, string | number | boolean | undefined> = Record<
    string,
    string | number | boolean | undefined
  >,
>(
  url: string,
  params: T,
): string => {
  let hasAddedFirstParam = false;
  let rawQueryString = '';
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      if (hasAddedFirstParam) {
        rawQueryString += '&';
      } else {
        hasAddedFirstParam = true;
      }
      rawQueryString += `${key}=${value.toString()}`;
    }
  }

  return `${url}?${rawQueryString}`;
};

/**
 * Get url with search params.
 *
 * Useful for adding optionals params to a url.
 *
 * @example const url = getSearchParams('https://example.com', { foo: 'bar',
 * baz: undefined, }); // url = 'https://example.com?foo=bar'
 *
 * @param url the url
 * @returns the url with search params
 */

export const getSearchParams = <T extends Record<string, string>>(
  url: string,
  requiredParams?: (keyof T)[],
): T => {
  const searchParams = new URL(url, 'https://example.com').searchParams;
  const params = {} as T;
  searchParams.forEach((value, key) => {
    params[key as keyof T] = value as T[keyof T];
  });

  if (requiredParams) {
    for (const requiredParam of requiredParams) {
      if (!params[requiredParam]) {
        throw toAppError({
          errorType: 'invalid-argument',
          errorMessage: `Missing required param ${requiredParam.toString()} in url ${url}`,
        });
      }
    }
  }

  return params;
};

/**
 * Convert an object to a search parameters string.
 *
 * Remember to add a '?' before the string if you want to use it in a url.
 *
 * @example toSearchParameters({ foo: 'bar', baz: undefined, }) // foo=bar
 *
 * @example toSearchParameters({ baz: true, boz: 23 }) //foo=bar&baz=true&boz=23
 *
 * @param data the object to convert
 * @returns the search parameters string
 */
export const toSearchParameters = (data: Record<string, string | number | boolean | undefined>) => {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      parameters.set(key, value.toString());
    }
  }
  return parameters.toString();
};

export const setSearchParameters = <
  T extends Record<string, string | number | boolean | undefined>,
>(
  searchParams: URLSearchParams,
  data: T,
) => {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      searchParams.set(key, value.toString());
    }
  }
  return parameters.toString();
};

export const safeTry = async <T>(promise: Promise<T> | T): Promise<T | undefined> => {
  try {
    return await promise;
  } catch (error) {
    logger.warn(error);
    return;
  }
};

export const getLocaleFromURL = <T extends string>(url: string, fallbackLocale = 'en'): T => {
  const match = url.match(/^\/([A-Z]{2})([/?].*)?$/i);
  const locale = match?.[1] ?? fallbackLocale;

  return locale as T;
};

/**
 * Get file extension from a file name
 *
 * @param fileName the file name
 * @returns the file extension
 */
export const getFileExtensionFromFileName = (fileName: string) => {
  const match = fileName.match(/\.([^.]+)$/);
  return match?.[1] ?? '';
};

export const getValueFromSearchParam = <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  searchParams: URLSearchParams,
  key: Extract<keyof T, string>,
): string | undefined => {
  const value = searchParams.get(key);
  if (!value || value === 'undefined' || value === 'null') {
    return;
  }
  return value;
};

/**
 * Returns true to indicate the swarm pipeline is ready.
 *
 * @returns Always true.
 */
export const isSwarmReady = (): boolean => true;

export const getAssociationIdFromSearchParam = <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  searchParams: URLSearchParams,
  key: Extract<keyof T, string>,
): UniversalValue | undefined => {
  const value = getValueFromSearchParam(searchParams, key);

  if (!value) {
    return;
  }

  // tru to make value to number, fallback to string, try catch is faster than isNaN
  try {
    const numberValue = Number(value);
    if (!Number.isNaN(numberValue) && Number.isFinite(numberValue)) {
      return numberValue;
    }
  } catch (_error) {
    // ignore
  }
  return value;
};
