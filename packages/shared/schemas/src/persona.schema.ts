import { z } from "zod";

export const PersonaSchema = z.object({
	id: z.string().min(1, "ID is required"),
	name: z
		.string()
		.min(1, "Name is required")
		.max(100, "Name must be 100 characters or less"),
	race: z.string().min(1, "Race is required"),
	characterClass: z.string().min(1, "Character class is required"),
	level: z
		.number()
		.int()
		.min(1, "Level must be at least 1")
		.max(20, "Level cannot exceed 20"),
	background: z.string().min(1, "Background is required"),
	attributes: z.object({
		strength: z.number().int().min(1).max(20),
		dexterity: z.number().int().min(1).max(20),
		constitution: z.number().int().min(1).max(20),
		intelligence: z.number().int().min(1).max(20),
		wisdom: z.number().int().min(1).max(20),
		charisma: z.number().int().min(1).max(20),
	}),
	proficiencies: z.array(z.string()).default([]),
});

export type Persona = z.infer<typeof PersonaSchema>;
