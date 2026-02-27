/**
 * replaces the locale slug in a relative url
 *
 * @example replaceLocaleInURL('/en/blog/article-1', 'de') //
 * '/de/blog/article-1'
 *
 * @param path the path
 * @param locale the locale
 * @returns the new path
 */
export const replaceLocaleInURL = (path: string, locale: string): string => {
  const rest = path.split('/').slice(2);
  return `/${[locale, ...rest].join('/')}`;
};
