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

import { expressionAssetTag } from '@aikami/constants';
import { type ContentPackManifest, isCatalogPortraitPath } from '@aikami/schemas';
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

/**
 * Logs a resolution diagnostic at most once per key. This getter re-evaluates
 * on every reactive expression change, so a repeated miss must not spam.
 */
const _reportOnce = (options: {
  seen: Set<string>;
  key: string;
  level: 'error' | 'warn';
  message: string;
  context: Record<string, unknown>;
}): void => {
  if (options.seen.has(options.key)) {
    return;
  }
  options.seen.add(options.key);
  if (options.level === 'error') {
    logger.error(options.message, options.context);
    return;
  }
  logger.warn(options.message, options.context);
};

/** Asserts a sprite folder is registered and returns its expression list. */
const _getAvailableExpressions = (sprite: string): readonly string[] =>
  NPC_SPRITE_EXPRESSIONS[sprite] ?? [];

/** Build the catalog tag for a portrait sprite + expression. */
const _portraitTag = (sprite: string, expression: string): string =>
  `portraits:npc:${sprite}:${expression}`;

/**
 * Resolves a locally generated portrait for an NPC, or `undefined` when none
 * was generated. Tries the requested emotion, then `neutral` — contextual
 * generation registers a neutral bust on first interaction (C-512 AC-2).
 */
const _resolveGeneratedPortrait = (options: {
  npcId: string;
  expression: string;
}): string | undefined => {
  const { npcId, expression } = options;
  const emotions =
    expression === DEFAULT_EXPRESSION ? [expression] : [expression, DEFAULT_EXPRESSION];

  for (const emotion of emotions) {
    const tag = expressionAssetTag({ npcId, emotion });
    const url = assetStore.resolveUrl(tag);
    if (url) {
      logger.spam('npcAvatar.resolve:generated', { npcId, emotion, tag });
      return url;
    }
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Pack-authored portraits
// ---------------------------------------------------------------------------

/**
 * The active content pack's manifest, registered once by the game bootstrap.
 *
 * Module-level because the avatar getter is a reactive property read during
 * render: threading the manifest through every call site (dialogue overlay,
 * combat view model, dev sandbox) would put pack plumbing in view models that
 * have no other business with it. The bootstrap owns exactly one active pack,
 * so this is a single source, not shared mutable state between packs.
 */
let _packManifest: ContentPackManifest | undefined;

/**
 * Registers the pack whose authored portraits this resolver should prefer.
 *
 * Called from the game bootstrap when a pack is loaded, and with `undefined`
 * when none is active (the pre-portrait behaviour).
 */
export const configureNpcPortraitSource = (manifest: ContentPackManifest | undefined): void => {
  _packManifest = manifest;
};

/**
 * Converts a pack-authored portrait URL to its catalog tag.
 *
 * Mirrors `pathToTag` for the `portraits` category, which carries no
 * `tagIncludesExtension`: `/game-data/portraits/emberwatch/x/neutral.png` →
 * `portraits:emberwatch:x:neutral`.
 */
export const portraitUrlToTag = (url: string): string | undefined => {
  if (!isCatalogPortraitPath(url)) {
    return undefined;
  }
  const withoutRoot = url.startsWith('/game-data/') ? url.slice('/game-data/'.length) : url;
  const withoutExt = withoutRoot.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/\//g, ':');
};

/**
 * Resolves a portrait the PACK authorises for this NPC, or `undefined`.
 *
 * The requested emotion is tried first, then `neutral` — `neutral` is the one
 * variant the schema requires, so a pack that authors any portrait always has
 * a safe target. A declared-but-unresolvable URL is reported and skipped rather
 * than returned: an `<img>` pointing at bytes that are not in the catalog is a
 * broken bust, not a portrait.
 */
const _resolvePackPortrait = (options: {
  npcId: string;
  expression: string;
}): string | undefined => {
  const { npcId, expression } = options;
  const variants = _packManifest?.npcs?.[npcId]?.portraits?.variants;
  if (variants === undefined) {
    return undefined;
  }
  const emotions =
    expression === DEFAULT_EXPRESSION ? [expression] : [expression, DEFAULT_EXPRESSION];
  for (const emotion of emotions) {
    const url = (variants as Record<string, string | undefined>)[emotion];
    if (url === undefined) {
      continue;
    }
    const tag = portraitUrlToTag(url);
    if (tag === undefined) {
      logger.warn('NpcAvatarCatalog: pack portrait path is unsupported', {
        npcId,
        emotion,
        url,
      });
      continue;
    }
    const resolved = assetStore.resolveUrl(tag);
    if (resolved) {
      logger.spam('npcAvatar.resolve:pack', { npcId, emotion, url });
      return resolved;
    }
    logger.warn('NpcAvatarCatalog: pack portrait is declared but not in the catalog', {
      npcId,
      emotion,
      url,
    });
  }
  return undefined;
};

/**
 * Resolves the portrait URL for an NPC.
 *
 * Resolution order:
 * 1. A **pack-authored** portrait declared at
 *    `manifest.npcs[npcId].portraits.variants` — the pack's own bust for this
 *    character. This is what replaced the generic `gandalf`/`orc`/`aragon`
 *    stand-ins that made Elder Thalia render as Gandalf. The requested emotion
 *    is tried first, then `neutral`.
 * 2. A **locally generated** portrait registered under
 *    `expressionAssetTag({ npcId, emotion })` (C-512) — checked before the
 *    hardcoded sprite map so a generated portrait wins over the catalog
 *    fallback.
 * 3. `NPC_AVATAR_SPRITE_MAP[npcId]`
 * 4. `PERSONA_AVATAR_SPRITE_MAP[personaId]`
 * 5. Error log + {@link PLACEHOLDER_AVATAR_URL}
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

  // 1. The pack's own authored portrait for this character.
  const packUrl = _resolvePackPortrait({ npcId, expression });
  if (packUrl) {
    return packUrl;
  }

  // 2. A locally generated portrait (C-512). Consulted before the sprite map:
  //    an NPC missing from the map, or one whose generated portrait differs
  //    from its catalog sprite, must still render the generated art.
  const generatedUrl = _resolveGeneratedPortrait({ npcId, expression });
  if (generatedUrl) {
    return generatedUrl;
  }

  const sprite = NPC_AVATAR_SPRITE_MAP[npcId] ?? PERSONA_AVATAR_SPRITE_MAP[personaId ?? ''];
  if (!sprite) {
    _reportOnce({
      seen: _reportedMissing,
      key: `missing:${npcId}:${personaId ?? ''}`,
      level: 'error',
      message: 'NpcAvatarCatalog: no avatar portrait configured for NPC',
      context: {
        npcId,
        npcName,
        personaId,
        hint: 'Add an entry to NPC_AVATAR_SPRITE_MAP or set personaId on the NPC spawn point.',
      },
    });
    return PLACEHOLDER_AVATAR_URL;
  }

  const available = _getAvailableExpressions(sprite);
  if (available.length === 0) {
    _reportOnce({
      seen: _reportedMissing,
      key: `unknown-sprite:${sprite}`,
      level: 'error',
      message: 'NpcAvatarCatalog: portrait sprite folder not registered',
      context: {
        npcId,
        npcName,
        sprite,
        hint: `Create portraits/npc/${sprite}/neutral.webp and register its expressions in NPC_SPRITE_EXPRESSIONS.`,
      },
    });
    return PLACEHOLDER_AVATAR_URL;
  }

  const clamped = available.includes(expression) ? expression : DEFAULT_EXPRESSION;
  if (clamped !== expression) {
    _reportOnce({
      seen: _reportedClamped,
      key: `clamped:${sprite}:${expression}`,
      level: 'warn',
      message: 'NpcAvatarCatalog: expression unavailable for sprite, clamped to neutral',
      context: { npcId, npcName, sprite, requested: expression, available },
    });
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
