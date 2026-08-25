// packages/shared/types/src/lib/domain/character_card.ts

/** biome-ignore-all lint/style/useNamingConvention: Character card format uses snake_case */

/** Character persona definition used in character card format (v1/v2). */
export type Character = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
  avatarUrl?: string;
  voiceConfigId?: string;
};

/** V2 character card wrapper with spec metadata. */
export type CharacterCardV2 = {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: Character;
};

/**
 * A single SillyTavern V3 asset descriptor.
 *
 * V3 `data.assets` is an array of descriptors, not a record — each entry
 * points at an external card/thumbnail/character asset URL (SillyTavern V3
 * spec). Imports normalize these into `character.extensions.assets` so both
 * the PNG (`ccv3`) and JSON paths expose the same output contract.
 */
export type CharacterCardV3Asset = {
  /** Asset kind: the main card image, a thumbnail, or a character asset. */
  type: 'card' | 'thumbnail' | 'character' | (string & {});
  /** Public URL of the asset. */
  uri: string;
  /** Optional display name. */
  name?: string;
};

/**
 * V3 character card wrapper (C-419).
 *
 * SillyTavern V3 (`chara_card_v3`) carries the same `data` fields as V2 plus
 * optional V3-only `assets` — an array of {@link CharacterCardV3Asset}
 * descriptors. The `data` shape is the same `Character` record; the extra
 * fields are not flattened into `Character`.
 */
export type CharacterCardV3 = {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: Character & { assets?: CharacterCardV3Asset[] };
};

/**
 * V2/V3 embedded lorebook (character_book). Spec field names are snake_case.
 * See https://github.com/malfoyslastname/character-card-spec-v2
 */
export type CharacterBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
};

/** A single entry within a V2/V3 character_book. */
export type CharacterBookEntry = {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: 'before_char' | 'after_char';
};

/** V1 character card (subset of Character fields). */
export type CharacterCardV1 = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
};
