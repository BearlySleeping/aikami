import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { getDeletableFields } from "./utils.ts";

describe("getDeletableFields", () => {
	test("should return deletable fields for optional string fields", () => {
		const testSchema = z.object({
			requiredField: z.string(),
			optionalField: z.string().optional(),
		});

		const result = getDeletableFields(testSchema);

		expect(result).toHaveProperty("optionalField");
		expect(result.optionalField).toBeDefined();
	});

	test("should not include required fields", () => {
		const testSchema = z.object({
			requiredField: z.string(),
			optionalField: z.string().optional(),
		});

		const result = getDeletableFields(testSchema);

		expect(result).not.toHaveProperty("requiredField");
	});

	test("should make optional fields union with FieldValueSchema", () => {
		const testSchema = z.object({
			optionalField: z.string().optional(),
		});

		const result = getDeletableFields(testSchema);

		const validData = { optionalField: "test" };
		const result1 = testSchema.extend(result).parse(validData);
		expect(result1.optionalField).toBe("test");
	});

	test("should handle multiple optional fields", () => {
		const testSchema = z.object({
			required: z.string(),
			opt1: z.string().optional(),
			opt2: z.number().optional(),
			opt3: z.boolean().optional(),
		});

		const result = getDeletableFields(testSchema);

		expect(Object.keys(result).length).toBe(3);
		expect(result).toHaveProperty("opt1");
		expect(result).toHaveProperty("opt2");
		expect(result).toHaveProperty("opt3");
	});
});
