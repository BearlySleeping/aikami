import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LocaleDataSchema, SupportedLocaleSchema } from "./preference.ts";

describe("SupportedLocaleSchema", () => {
	test("should parse en locale", () => {
		expect(SupportedLocaleSchema.parse("en")).toBe("en");
	});

	test("should reject unsupported locale", () => {
		expect(() => SupportedLocaleSchema.parse("fr")).toThrow(z.ZodError);
		expect(() => SupportedLocaleSchema.parse("es")).toThrow(z.ZodError);
	});
});

describe("LocaleDataSchema", () => {
	test("should parse valid locale data", () => {
		const validData = { en: "English" };
		const result = LocaleDataSchema.parse(validData);
		expect(result.en).toBe("English");
	});

	test("should parse with optional value undefined", () => {
		const validData = { en: undefined };
		const result = LocaleDataSchema.parse(validData);
		expect(result.en).toBeUndefined();
	});

	test("should reject unsupported locale key", () => {
		const invalidData = { fr: "French" };
		expect(() => LocaleDataSchema.parse(invalidData)).toThrow(z.ZodError);
	});
});
