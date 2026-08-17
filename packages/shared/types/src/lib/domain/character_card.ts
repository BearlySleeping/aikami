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
 * V3 character card wrapper (C-419).
 *
 * SillyTavern V3 (`chara_card_v3`) carries the same `data` fields as V2 plus
 * optional V3-only extensions such as `assets`. The `data` shape is the same
 * `Character` record — extra V3 fields ride along in `assets` and are not
 * flattened into `Character`.
 */
export type CharacterCardV3 = {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: Character & { assets?: Record<string, unknown> };
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
