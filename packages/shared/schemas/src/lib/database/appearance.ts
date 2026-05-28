import { z } from "zod";

export const AppearanceSchema = z.object({
	avatarUrl: z
		.string()
		.url()
		.describe("URL to the character avatar image")
		.optional(),
	portraitUrl: z
		.string()
		.url()
		.describe("URL to the character portrait")
		.optional(),
	physicalDescription: z
		.string()
		.describe("Physical description of the character")
		.optional(),
	age: z.string().describe("Character age").optional(),
	height: z.string().describe("Character height").optional(),
	weight: z.string().describe("Character weight").optional(),
	eyeColor: z.string().describe("Eye color").optional(),
	hairColor: z.string().describe("Hair color").optional(),
	skinColor: z.string().describe("Skin color").optional(),
	distinguishingMarks: z
		.string()
		.describe("Scars, tattoos, or other distinguishing marks")
		.optional(),
});

export type AppearanceData = z.infer<typeof AppearanceSchema>;
