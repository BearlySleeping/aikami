// packages/shared/schemas/src/lib/common/preference.ts
import Type from 'typebox';

/**
 * The supported language codes on the public client and flutter app.
 * https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
 */
// supportedLocales = ['en'] as const
export const SupportedLocaleSchema = Type.Union([Type.Literal('en')]);

export const LocaleDataSchema = Type.Record(SupportedLocaleSchema, Type.Optional(Type.String()));
