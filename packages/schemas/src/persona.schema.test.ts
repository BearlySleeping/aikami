import { describe, expect, test } from "bun:test";
import { type Persona, PersonaSchema } from "./persona.schema.ts";

describe("PersonaSchema", () => {
	test("should validate a valid persona", () => {
		const validPersona = {
			id: "persona-123",
			name: "Astarion Ancunín",
			race: "High Elf",
			characterClass: "Rogue",
			level: 5,
			background: "A vampire spawn.",
			attributes: {
				strength: 10,
				dexterity: 17,
				constitution: 14,
				intelligence: 13,
				wisdom: 13,
				charisma: 10,
			},
			proficiencies: ["Stealth", "Deception"],
		};
		const result = PersonaSchema.safeParse(validPersona);
		expect(result.success).toBe(true);
	});

	test("should reject persona with invalid level", () => {
		const invalidPersona = {
			id: "persona-789",
			name: "Gale",
			race: "Human",
			characterClass: "Wizard",
			level: 25, // Invalid
			background: "A wizard.",
			attributes: {
				strength: 8,
				dexterity: 13,
				constitution: 14,
				intelligence: 17,
				wisdom: 10,
				charisma: 13,
			},
		};
		expect(PersonaSchema.safeParse(invalidPersona).success).toBe(false);
	});
});
