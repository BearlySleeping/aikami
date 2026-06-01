// packages/shared/schemas/src/lib/parser.ts
//
// TypeBox schemas for macro & slash command AST nodes.
// Used by @aikami/parser for runtime validation of parsed tokens.

import Type from 'typebox';

/**
 * Base AST node shared shape.
 */
export const ASTNodeSchema = Type.Object({
  type: Type.String(),
});

/**
 * A recognized slash command: `/roll 1d20` → { type: "command", command: "roll", args: ["1d20"] }
 */
export const CommandNodeSchema = Type.Intersect([
  ASTNodeSchema,
  Type.Object({
    type: Type.Literal('command'),
    command: Type.String({ minLength: 1 }),
    args: Type.Array(Type.String()),
    raw: Type.String(),
  }),
]);

/**
 * A mustache-style macro within text: `{{trigger_anim:attack}}` → { type: "macro", name: "trigger_anim", args: ["attack"] }
 */
export const MacroNodeSchema = Type.Intersect([
  ASTNodeSchema,
  Type.Object({
    type: Type.Literal('macro'),
    name: Type.String({ minLength: 1 }),
    args: Type.Array(Type.String()),
    raw: Type.String(),
  }),
]);

/**
 * Plain dialogue text.
 */
export const TextNodeSchema = Type.Intersect([
  ASTNodeSchema,
  Type.Object({
    type: Type.Literal('text'),
    content: Type.String(),
    raw: Type.String(),
  }),
]);

// Inferred types
export type ASTNode = Type.Static<typeof ASTNodeSchema>;
export type CommandNode = Type.Static<typeof CommandNodeSchema>;
export type MacroNode = Type.Static<typeof MacroNodeSchema>;
export type TextNode = Type.Static<typeof TextNodeSchema>;
