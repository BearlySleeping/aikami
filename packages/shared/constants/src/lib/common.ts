/**
 * The supported language codes on the public client and flutter app.
 * https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
 */
export const supportedLocales = ['en'] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

/**
 * Check if a value is a supported locale.
 *
 * @param locale The locale to check.
 * @returns True if the locale is supported, false otherwise.
 */
export const isSupportedLocale = (locale: unknown): locale is SupportedLocale =>
  typeof locale === 'string' && supportedLocales.includes(locale as SupportedLocale);

/**
 * Get a supported locale from a value, with an optional fallback.
 *
 * @param locale The locale to check.
 * @param fallback The fallback locale to use if the input is not supported.
 * @returns A supported locale.
 */
export const getSupportedLocale = (
  locale: unknown,
  fallback: SupportedLocale = 'en',
): SupportedLocale => {
  if (isSupportedLocale(locale)) {
    return locale;
  }
  return fallback;
};
