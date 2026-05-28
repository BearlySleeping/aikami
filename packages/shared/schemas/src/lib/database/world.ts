import { z } from "zod";

export const WorldLocationSchema = z.object({
	id: z.string().describe("Unique identifier"),
	name: z.string().describe("Location name"),
	description: z.string().describe("Location description"),
	connections: z
		.string()
		.array()
		.describe("IDs of connected locations")
		.default([]),
	npcIds: z.string().array().describe("NPCs at this location").default([]),
	lastVisited: z.string().datetime().optional(),
});

export const WorldEventSchema = z.object({
	id: z.string().describe("Unique identifier"),
	title: z.string().describe("Event title"),
	description: z.string().describe("Event description"),
	participantIds: z
		.string()
		.array()
		.describe("Character IDs involved")
		.default([]),
	locationId: z.string().optional(),
	timestamp: z.string().datetime().describe("In-world timestamp"),
	isMajor: z.boolean().describe("Is major event").default(false),
});

export const WorldStateSchema = z.object({
	id: z.string().describe("Unique identifier"),
	uid: z.string().describe("Owner user ID"),
	name: z.string().describe("World name"),
	description: z.string().describe("World description"),
	locations: WorldLocationSchema.array().default([]),
	events: WorldEventSchema.array().default([]),
	variables: z
		.record(z.string(), z.unknown())
		.describe("Custom world variables")
		.default({}),
	createdAt: z.string().datetime().describe("Creation timestamp"),
	updatedAt: z.string().datetime().describe("Last update timestamp"),
});

export type WorldLocationData = z.infer<typeof WorldLocationSchema>;
export type WorldEventData = z.infer<typeof WorldEventSchema>;
export type WorldStateData = z.infer<typeof WorldStateSchema>;
