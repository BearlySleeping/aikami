import type { LangData, SupportedLocale, Timestamp } from '@aikami/types';
import { logger } from '$logger';
import { toAppError } from './error.ts';
import { toFixedNumber } from './utils.ts';

/**
 * Convert the user's locale to one of the supported locale
 *
 * @param localeCode The user's locale code
 * @returns The supported locale code, default: 'en'
 */
export const toSupportedLocale = (localeCode?: string): SupportedLocale => {
  switch (localeCode) {
    default:
      return 'en';
  }
};

export const getTranslatedText = (text: LangData, locale: string | SupportedLocale): string => {
  const translatedText =
    text[locale as SupportedLocale] ?? text.en ?? text[Object.keys(text)[0] as SupportedLocale];

  if (!translatedText) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'No text found',
    });
  }
  return translatedText;
};

/**
 * Get the date from a timestamp. If the timestamp is undefined, then return the
 * current date.
 *
 * @param timestamp the timestamp to get the date from
 * @returns the date
 */
export const getDate = (
  timestamp:
    | Timestamp
    | { _seconds: number; _nanoseconds: number }
    | number
    | string
    | Date
    | undefined
    | null
    | boolean,
): Date => {
  try {
    if (!timestamp || typeof timestamp === 'boolean') {
      return new Date();
    }

    if (typeof timestamp === 'number' || typeof timestamp === 'string') {
      return new Date(timestamp);
    }
    if ('_seconds' in timestamp) {
      return new Date(timestamp._seconds * 1000);
    }

    if (timestamp instanceof Date) {
      return timestamp;
    }

    return timestamp.toDate();
  } catch (error) {
    logger.error('getDate', error);
    return new Date();
  }
};

/**
 * @example toDisplayDuration(85600) // '1:25' toDisplayDuration(85600, true) //
 * '1:25.6'
 *
 * @param time the time in milliseconds
 * @param showInDecisecond if true then show the seconds in decisecond
 * @returns a readable time
 */
export const toDisplayDuration = (time: number, showInDecisecond = false): string => {
  const durationSeconds = time / 1000;
  const getSeconds = (secondsValue: number) =>
    showInDecisecond ? toFixedNumber(secondsValue, 1) : Math.floor(secondsValue);

  if (durationSeconds < 60) {
    return `00:${durationSeconds < 10 ? `0${getSeconds(durationSeconds)}` : getSeconds(durationSeconds)}`;
  }
  if (durationSeconds < 3600) {
    const minutes = Math.trunc(durationSeconds / 60);
    const seconds = durationSeconds - minutes * 60;
    return `${minutes}:${seconds < 10 ? `0${getSeconds(seconds)}` : getSeconds(seconds)}`;
  }
  const hours = Math.trunc(durationSeconds / 3600);
  const minutes = Math.trunc((durationSeconds % 3600) / 60);
  const seconds = Math.trunc((durationSeconds % 3600) % 60);
  return `${hours}:${minutes < 10 ? `0${minutes}` : minutes}:${
    seconds < 10 ? `0${getSeconds(seconds)}` : getSeconds(seconds)
  }`;
};

export const toDisplayDate = (date: Date): string => {
  let month = String(date.getMonth() + 1);
  let day = String(date.getDate());
  const year = date.getFullYear();
  if (month.length < 2) {
    month = `0${month}`;
  }
  if (day.length < 2) {
    day = `0${day}`;
  }
  return [year, month, day].join('-');
};

/**
 * @example replaceBaseURL('http://old.com/some/random/path','https://new.app')
 * // 'https://new.app/some/random/path'
 *
 * @param url the url to replace
 * @param newBaseURL the base url to replace with the url
 * @returns the new url with the new base url
 */
export const replaceBaseURL = (url: string, newBaseURL: string) => {
  const topLevelDomains = ['.com/', '.dev/', '.net/'];
  for (const topLevelDomain of topLevelDomains) {
    if (url.includes(topLevelDomain)) {
      return `${newBaseURL}/${url.slice(
        Math.max(0, url.lastIndexOf(topLevelDomain) + topLevelDomain.length),
      )}`;
    }
  }
  return url;
};
