import { z } from "zod";
import {
	CoreCreateSchema,
	CoreOmitSchema,
	CoreSchema,
	CoreUpdateSchema,
} from "../core.ts";
import { getDeletableFields } from "../utils.ts";

export const GroupChatSchema = CoreSchema.extend({
	uid: z.string().describe("Owner user ID"),
	name: z.string().describe("Group chat name"),
	characterIds: z.string().array().describe("NPC IDs in the group").default([]),
	personaId: z.string().optional(),
	lorebookId: z.string().optional(),
	replyMode: z
		.enum(["sequential", "random", "simultaneous"])
		.describe("How characters respond")
		.default("sequential"),
});

export const GroupChatCreateSchema = GroupChatSchema.omit(
	CoreOmitSchema,
).extend(CoreCreateSchema.shape);

export const GroupChatUpdateSchema = GroupChatSchema.extend(
	getDeletableFields(GroupChatSchema),
)
	.omit(CoreOmitSchema)
	.extend(CoreUpdateSchema.shape);

export const GroupMessageSchema = z.object({
	id: z.string().describe("Unique identifier"),
	groupChatId: z.string().describe("Group chat ID"),
	characterId: z.string().describe("Character who sent this"),
	sender: z.enum(["user", "character"]).describe("Message sender"),
	text: z.string().describe("Message text"),
	timestamp: z.string().datetime().describe("Timestamp"),
});

export type GroupChatData = z.infer<typeof GroupChatSchema>;
export type GroupChatUpdateData = z.infer<typeof GroupChatUpdateSchema>;
export type GroupMessageData = z.infer<typeof GroupMessageSchema>;
