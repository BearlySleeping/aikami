// packages/shared/schemas/src/lib/domain/character_book.ts
//
// TypeBox schemas for the V2/V3 character_book (embedded lorebook) field.
// This is the V2/V3 spec shape — distinct from the existing LorebookSchema
// (server-side) and the client-local LorebookEntry type.
//
// See: https://github.com/malfoyslastname/character-card-spec-v2

import Type from 'typebox';

// ── CharacterBookEntrySchema ──────────────────────────────────────────────

export const CharacterBookEntrySchema = Type.Object({
  keys: Type.Array(Type.String(), { description: 'Keywords that trigger this entry' }),
  content: Type.String({ description: 'The lore content to inject' }),
  extensions: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Vendor-specific extensions (preserved verbatim)',
    default: {},
  }),
  enabled: Type.Boolean({ description: 'Whether this entry is active', default: true }),
  // biome-ignore lint/style/useNamingConvention: External character card spec uses snake_case
  insertion_order: Type.Integer({ description: 'Order/priority within the book' }),
  // biome-ignore lint/style/useNamingConvention: External character card spec uses snake_case
  case_sensitive: Type.Optional(
    Type.Boolean({ description: 'Whether keyword matching is case-sensitive' }),
  ),
  name: Type.Optional(Type.String({ description: 'Optional entry name' })),
  priority: Type.Optional(Type.Integer({ description: 'Spec-level priority' })),
  id: Type.Optional(Type.Integer({ description: 'Unique entry ID within the book' })),
  comment: Type.Optional(Type.String({ description: 'Author comment' })),
  selective: Type.Optional(
    Type.Boolean({ description: 'Only trigger when secondary keys also match' }),
  ),
  // biome-ignore lint/style/useNamingConvention: External character card spec uses snake_case
  secondary_keys: Type.Optional(
    Type.Array(Type.String(), { description: 'Additional required keywords' }),
  ),
  constant: Type.Optional(Type.Boolean({ description: 'Always include regardless of keywords' })),
  position: Type.Optional(Type.Union([Type.Literal('before_char'), Type.Literal('after_char')])),
});

export type CharacterBookEntryData = Type.Static<typeof CharacterBookEntrySchema>;

// ── CharacterBookSchema ────────────────────────────────────────────────────

export const CharacterBookSchema = Type.Object({
  name: Type.Optional(Type.String({ description: 'Lorebook name' })),
  description: Type.Optional(Type.String({ description: 'Lorebook description' })),
  // biome-ignore lint/style/useNamingConvention: External character card spec uses snake_case
  scan_depth: Type.Optional(
    Type.Integer({ description: 'How far back to scan for keyword matches' }),
  ),
  // biome-ignore lint/style/useNamingConvention: External character card spec uses snake_case
  token_budget: Type.Optional(
    Type.Integer({ description: 'Maximum token budget for matched entries' }),
  ),
  // biome-ignore lint/style/useNamingConvention: External character card spec uses snake_case
  recursive_scanning: Type.Optional(Type.Boolean({ description: 'Whether to scan recursively' })),
  extensions: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Vendor-specific extensions (preserved verbatim)',
    default: {},
  }),
  entries: Type.Array(CharacterBookEntrySchema, {
    description: 'The lorebook entries',
  }),
});

export type CharacterBookData = Type.Static<typeof CharacterBookSchema>;
