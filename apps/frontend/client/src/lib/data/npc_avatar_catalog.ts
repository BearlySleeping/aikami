// apps/frontend/client/src/lib/data/npc_avatar_catalog.ts
//
// NPC + player portrait avatar resolution for the dialogue overlay.
//
// Portraits are pre-generated WebP busts stored in the game-data catalog
// under portraits/npc/{sprite}/{expression}.webp (published to R2 and
// resolved through the AssetStore). Each known NPC id and player
// class maps to a sprite folder; resolution validates that the requested
// expression exists for the sprite, falls back to 'neutral', and — when no
// portrait is configured at all — logs an error and returns a placeholder
// image. The in-world LPC body spritesheet (bodies_male.walk.webp) is
// NEVER used as a portrait avatar.
//
// Contract: C-239 Expression Emotion System (sprite folders), dialogue avatar fix
/** biome-ignore-all lint/style/useNamingConvention: content-pack NPC ids use snake_case by design */

import { assetStore } from '$lib/services/assets/asset_store.svelte';
import { logger } from '$logger';
import { NPC_SPRITE_EXPRESSIONS } from './npc_sprite_expressions';

/** Portrait shown when no avatar image is available for a character. */
export const PLACEHOLDER_AVATAR_URL = '/game-data/portraits/npc/placeholder.svg' as const;

/**
 * Fallback base URL for NPC portraits when the asset store is unavailable.
 * Served from the SvelteKit static directory during dev; removed in production
 * once the asset store is always initialized.
 */
const NPC_SPRITE_BASE_URL = '/game-data/portraits/npc' as const;

/** Default expression used when none is requested or the requested one is unavailable. */
const DEFAULT_EXPRESSION = 'neutral' as const;

/**
 * Known NPC id → portrait sprite folder.
 *
 * Kept in sync with the emberwatch content-pack spawn points
 * (content/packs/emberwatch/maps/*.json). When a dedicated per-NPC
 * portrait is generated, add its sprite folder here (or carry
 * `avatarSprite` on the NPC spawn data and read it from there).
 */
export const NPC_AVATAR_SPRITE_MAP: Readonly<Record<string, string>> = {
  // ── Emberwatch village (village.json) ──
  village_elder: 'gandalf', // Elder Thalia — sage
  // ── Inn (inn.json) ──
  rollo_grasper: 'orc', // Rollo the Grasper — rogue
  // ── Merchant shop (merchant_shop.json) ──
  merchant: 'aragon', // Mara the Merchant
} as const;

/**
 * personaId → portrait sprite folder fallback, used when an NPC has no
 * npcId entry. Mirrors the dialogue dev-sandbox persona presets.
 */
export const PERSONA_AVATAR_SPRITE_MAP: Readonly<Record<string, string>> = {
  sage: 'gandalf',
  guard: 'aragon',
  innkeeper: 'gandalf',
  blacksmith: 'orc',
  bandit: 'orc',
  merchant: 'aragon',
  healer: 'gandalf',
  guildMaster: 'aragon',
  default: 'aragon',
} as const;

/**
 * Player class id → portrait sprite folder. Used for the dialogue overlay's
 * player avatar. Falls back to 'fighter' when the class is unknown.
 */
export const PLAYER_CLASS_AVATAR_SPRITE_MAP: Readonly<Record<string, string>> = {
  fighter: 'aragon',
  paladin: 'aragon',
  ranger: 'aragon',
  wizard: 'gandalf',
  bard: 'gandalf',
  cleric: 'gandalf',
  druid: 'gandalf',
  rogue: 'orc',
  barbarian: 'orc',
} as const;

/**
 * Keys already reported missing/clamped — each unique miss logs once
 * instead of spamming on every reactive re-resolution.
 */
const _reportedMissing = new Set<string>();
const _reportedClamped = new Set<string>();

/** Asserts a sprite folder is registered and returns its expression list. */
const _getAvailableExpressions = (sprite: string): readonly string[] =>
  NPC_SPRITE_EXPRESSIONS[sprite] ?? [];

/** Build the catalog tag for a portrait sprite + expression. */
const _portraitTag = (sprite: string, expression: string): string =>
  `portraits:npc:${sprite}:${expression}`;

/**
 * Resolves the portrait URL for an NPC.
 *
 * Resolution order:
 * 1. `NPC_AVATAR_SPRITE_MAP[npcId]`
 * 2. `PERSONA_AVATAR_SPRITE_MAP[personaId]`
 * 3. Error log + {@link PLACEHOLDER_AVATAR_URL}
 *
 * The requested expression is clamped to the sprite's available expressions
 * (warn + 'neutral' fallback). Debug traces use the spam-suppressed logger
 * because this getter re-evaluates on reactive expression changes.
 *
 * URLs are resolved through the AssetStore (cache → R2 → null)
 * when available, falling back to the static placeholder path.
 */
export const resolveNpcAvatarUrl = (options: {
  npcId: string;
  npcName?: string;
  personaId?: string;
  expression?: string;
}): string => {
  const { npcId, npcName, personaId, expression = DEFAULT_EXPRESSION } = options;
  logger.spam('npcAvatar.resolve', { npcId, npcName, personaId, expression });

  const sprite = NPC_AVATAR_SPRITE_MAP[npcId] ?? PERSONA_AVATAR_SPRITE_MAP[personaId ?? ''];
  if (!sprite) {
    const key = `missing:${npcId}:${personaId ?? ''}`;
    if (!_reportedMissing.has(key)) {
      _reportedMissing.add(key);
      logger.error('NpcAvatarCatalog: no avatar portrait configured for NPC', {
        npcId,
        npcName,
        personaId,
        hint: 'Add an entry to NPC_AVATAR_SPRITE_MAP or set personaId on the NPC spawn point.',
      });
    }
    return PLACEHOLDER_AVATAR_URL;
  }

  const available = _getAvailableExpressions(sprite);
  if (available.length === 0) {
    const key = `unknown-sprite:${sprite}`;
    if (!_reportedMissing.has(key)) {
      _reportedMissing.add(key);
      logger.error('NpcAvatarCatalog: portrait sprite folder not registered', {
        npcId,
        npcName,
        sprite,
        hint: `Create portraits/npc/${sprite}/neutral.webp and register its expressions in NPC_SPRITE_EXPRESSIONS.`,
      });
    }
    return PLACEHOLDER_AVATAR_URL;
  }

  const clamped = available.includes(expression) ? expression : DEFAULT_EXPRESSION;
  if (clamped !== expression) {
    const key = `clamped:${sprite}:${expression}`;
    if (!_reportedClamped.has(key)) {
      _reportedClamped.add(key);
      logger.warn('NpcAvatarCatalog: expression unavailable for sprite, clamped to neutral', {
        npcId,
        npcName,
        sprite,
        requested: expression,
        available,
      });
    }
  }

  // Resolve through the asset store (cache → R2 → null)
  const tag = _portraitTag(sprite, clamped);
  const resolved = assetStore.resolveUrl(tag);
  if (resolved) {
    logger.spam('npcAvatar.resolve:ok', { npcId, sprite, expression: clamped, url: resolved });
    return resolved;
  }

  // Asset store not available or tag unknown — fall back to static path
  // (dev mode / tests where the catalog hasn't been loaded).
  const fallbackUrl = `${NPC_SPRITE_BASE_URL}/${sprite}/${clamped}.webp`;
  logger.spam('npcAvatar.resolve:fallback', {
    npcId,
    sprite,
    expression: clamped,
    url: fallbackUrl,
  });
  return fallbackUrl;
};

/**
 * Resolves the portrait URL for the player character from its class.
 * Logs an error and returns the placeholder when the class has no portrait.
 * Resolves through the AssetStore when available.
 */
export const resolvePlayerAvatarUrl = (options: { classId?: string }): string => {
  const classId = options.classId ?? 'fighter';
  logger.spam('playerAvatar.resolve', { classId });

  const sprite = PLAYER_CLASS_AVATAR_SPRITE_MAP[classId];
  if (!sprite) {
    const key = `player-missing:${classId}`;
    if (!_reportedMissing.has(key)) {
      _reportedMissing.add(key);
      logger.error('NpcAvatarCatalog: no avatar portrait for player class', {
        classId,
        hint: 'Add an entry to PLAYER_CLASS_AVATAR_SPRITE_MAP.',
      });
    }
    return PLACEHOLDER_AVATAR_URL;
  }

  const tag = _portraitTag(sprite, DEFAULT_EXPRESSION);
  const resolved = assetStore.resolveUrl(tag);
  if (resolved) {
    logger.spam('playerAvatar.resolve:ok', { classId, sprite, url: resolved });
    return resolved;
  }

  // Asset store not available — fall back to static path (dev / tests).
  const fallbackUrl = `${NPC_SPRITE_BASE_URL}/${sprite}/${DEFAULT_EXPRESSION}.webp`;
  logger.spam('playerAvatar.resolve:fallback', { classId, sprite, url: fallbackUrl });
  return fallbackUrl;
};
