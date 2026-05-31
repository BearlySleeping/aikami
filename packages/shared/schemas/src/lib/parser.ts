// packages/shared/schemas/src/lib/parser.ts
//
// Zod schemas for macro & slash command AST nodes.
// Used by @aikami/parser for runtime validation of parsed tokens.

import { z } from "zod";

/**
 * Base AST node shared shape.
 */
export const ASTNodeSchema = z.object({
  type: z.string(),
});

/**
 * A recognized slash command: `/roll 1d20` → { type: "command", command: "roll", args: ["1d20"] }
 */
export const CommandNodeSchema = ASTNodeSchema.extend({
  type: z.literal("command"),
  command: z.string().min(1),
  args: z.array(z.string()),
  raw: z.string(),
});

/**
 * A mustache-style macro within text: `{{trigger_anim:attack}}` → { type: "macro", name: "trigger_anim", args: ["attack"] }
 */
export const MacroNodeSchema = ASTNodeSchema.extend({
  type: z.literal("macro"),
  name: z.string().min(1),
  args: z.array(z.string()),
  raw: z.string(),
});

/**
 * Plain dialogue text.
 */
export const TextNodeSchema = ASTNodeSchema.extend({
  type: z.literal("text"),
  content: z.string(),
  raw: z.string(),
});

// Inferred types
export type ASTNode = z.infer<typeof ASTNodeSchema>;
export type CommandNode = z.infer<typeof CommandNodeSchema>;
export type MacroNode = z.infer<typeof MacroNodeSchema>;
export type TextNode = z.infer<typeof TextNodeSchema>;
