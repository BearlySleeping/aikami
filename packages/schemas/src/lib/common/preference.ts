import { supportedLocales } from "@aikami/constants";
import { z } from "zod";

/**
 * The supported language codes on the public pwa and flutter app.
 * https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
 */
export const SupportedLocaleSchema = z.enum(supportedLocales);

export const LocaleDataSchema = z.record(
	SupportedLocaleSchema,
	z.string().optional(),
);
