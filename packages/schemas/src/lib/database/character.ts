import { z } from "zod";
import { AppearanceSchema } from "./appearance.ts";
import {
	DEFAULT_SAVING_THROWS,
	DEFAULT_SKILLS,
	SavingThrowSchema,
	SkillSchema,
} from "./skills.ts";

export const BaseCharacterSheetSchema = z
	.object({
		name: z.string().describe("Character Name (Required, max 100 characters)"),
		race: z.string().describe("Character Race (Required, max 50 characters)"),
		class: z.string().describe("Character Class (Required, max 50 characters)"),
		subclass: z.string().describe("Character Subclass (Optional)").optional(),
		level: z
			.number()
			.int()
			.describe("Character Level (Required, integer between 1 and 20)"),
		experiencePoints: z
			.number()
			.int()
			.describe("Experience Points (Required, non-negative integer)"),

		abilityScores: z
			.object({
				strength: z
					.number()
					.int()
					.describe("Strength Score (Required, integer between 1 and 30)"),
				dexterity: z
					.number()
					.int()
					.describe("Dexterity Score (Required, integer between 1 and 30)"),
				constitution: z
					.number()
					.int()
					.describe("Constitution Score (Required, integer between 1 and 30)"),
				intelligence: z
					.number()
					.int()
					.describe("Intelligence Score (Required, integer between 1 and 30)"),
				wisdom: z
					.number()
					.int()
					.describe("Wisdom Score (Required, integer between 1 and 30)"),
				charisma: z
					.number()
					.int()
					.describe("Charisma Score (Required, integer between 1 and 30)"),
			})
			.describe("Ability Scores"),

		hitPoints: z
			.number()
			.int()
			.describe("Hit Points (Required, non-negative integer)"),
		hitPointsMax: z.number().int().describe("Maximum Hit Points").optional(),
		temporaryHitPoints: z
			.number()
			.int()
			.describe("Temporary Hit Points")
			.default(0),
		armorClass: z
			.number()
			.int()
			.describe("Armor Class (Required, non-negative integer)"),
		speed: z.number().int().describe("Speed (Required, non-negative integer)"),
		initiative: z.number().int().describe("Initiative modifier").optional(),

		proficiencyBonus: z
			.number()
			.int()
			.describe("Proficiency bonus (derived from level)")
			.optional(),

		savingThrows: SavingThrowSchema.array()
			.describe("Saving throw proficiencies")
			.default(DEFAULT_SAVING_THROWS),

		skills: SkillSchema.array()
			.describe("Skill proficiencies")
			.default(DEFAULT_SKILLS),

		alignment: z
			.string()
			.describe(
				"Alignment (Required, one of: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil, max 50 characters)",
			),
		background: z.string().describe("Background (Required, max 50 characters)"),

		proficiencies: z
			.string()
			.array()
			.describe("Proficiencies (Array of strings)"),
		languages: z.string().array().describe("Languages (Array of strings)"),

		equipment: z.string().array().describe("Equipment (Array of strings)"),
		inventory: z.string().array().describe("Inventory (Array of strings)"),

		personalityTraits: z
			.string()
			.describe("Personality Traits (Optional, max 500 characters)")
			.optional(),
		ideals: z
			.string()
			.describe("Ideals (Optional, max 500 characters)")
			.optional(),
		bonds: z
			.string()
			.describe("Bonds (Optional, max 500 characters)")
			.optional(),
		flaws: z
			.string()
			.describe("Flaws (Optional, max 500 characters)")
			.optional(),

		appearance: AppearanceSchema.describe(
			"Character appearance details",
		).optional(),

		notes: z
			.string()
			.describe("Additional Notes (Optional, max 1000 characters)")
			.optional(),
	})
	.describe("D&D Character Sheet");
