import { z } from "zod";

export const StoryBranchSchema = z.object({
	id: z.string().describe("Unique identifier"),
	uid: z.string().describe("Owner user ID"),
	name: z.string().describe("Branch name"),
	description: z.string().describe("Branch description").default(""),
	parentBranchId: z.string().optional(),
	chatId: z.string().describe("Related chat ID"),
	divergedAtMessageId: z.string().describe("Message where branch split"),
	isActive: z.boolean().describe("Is active branch").default(true),
	createdAt: z.string().datetime().describe("Creation timestamp"),
	updatedAt: z.string().datetime().describe("Last update timestamp"),
});

export const BranchPointSchema = z.object({
	id: z.string().describe("Unique identifier"),
	chatId: z.string().describe("Related chat ID"),
	messageId: z.string().describe("Message ID"),
	choice: z.string().describe("Chosen option"),
	alternativeChoices: z.string().array().describe("Other options").default([]),
	branchId: z.string().describe("Resulting branch ID"),
});

export type StoryBranchData = z.infer<typeof StoryBranchSchema>;
export type BranchPointData = z.infer<typeof BranchPointSchema>;
