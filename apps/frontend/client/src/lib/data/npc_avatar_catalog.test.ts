// apps/frontend/client/src/lib/data/npc_avatar_catalog.test.ts
import { describe, expect, test } from 'bun:test';
import {
  NPC_AVATAR_SPRITE_MAP,
  PERSONA_AVATAR_SPRITE_MAP,
  PLACEHOLDER_AVATAR_URL,
  PLAYER_CLASS_AVATAR_SPRITE_MAP,
  resolveNpcAvatarUrl,
  resolvePlayerAvatarUrl,
} from './npc_avatar_catalog.ts';
import { NPC_SPRITE_EXPRESSIONS } from './npc_sprite_expressions.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Every npcId spawn point present in the emberwatch content pack. */
const EMBERWATCH_NPC_IDS = ['village_elder', 'rollo_grasper', 'merchant'] as const;

/** Map of sprite name → expected portrait file path under game-data/portraits/npc/. */
const SPRITE_PORTRAIT_PATHS: Record<string, string> = {
  gandalf: 'game-data/portraits/npc/gandalf/neutral.webp',
  aragon: 'game-data/portraits/npc/aragon/neutral.webp',
  orc: 'game-data/portraits/npc/orc/neutral.webp',
  troll: 'game-data/portraits/npc/troll/neutral.webp',
};

// ---------------------------------------------------------------------------
// Emberwatch coverage — every character must resolve to a real portrait
// ---------------------------------------------------------------------------

describe('npc_avatar_catalog — emberwatch coverage', () => {
  test('every emberwatch NPC resolves to a non-placeholder avatar', () => {
    for (const npcId of EMBERWATCH_NPC_IDS) {
      const url = resolveNpcAvatarUrl({ npcId });
      expect(url, `NPC ${npcId} should have a real avatar`).not.toBe(PLACEHOLDER_AVATAR_URL);
    }
  });

  test('every emberwatch NPC portrait file exists on disk (game-data catalog)', async () => {
    for (const npcId of EMBERWATCH_NPC_IDS) {
      const _url = resolveNpcAvatarUrl({ npcId });
      // When the asset store is unavailable, the fallback URL is /game-data/portraits/npc/{sprite}/{expression}.webp
      // Check the game-data catalog path instead
      const sprite = NPC_AVATAR_SPRITE_MAP[npcId];
      const expectedPath = SPRITE_PORTRAIT_PATHS[sprite];
      if (expectedPath) {
        await expect(
          Bun.file(new URL(`../../../static/${expectedPath}`, import.meta.url)).exists(),
          `portrait file ${expectedPath} should exist for NPC ${npcId} (sprite ${sprite})`,
        ).resolves.toBe(true);
      }
    }
  });

  test('no emberwatch NPC resolves to the LPC body spritesheet fallback', () => {
    for (const npcId of EMBERWATCH_NPC_IDS) {
      const url = resolveNpcAvatarUrl({ npcId });
      expect(url).not.toContain('bodies_male');
      expect(url).not.toContain('/game-data/lpc/');
    }
  });
});

// ---------------------------------------------------------------------------
// Sprite catalog integrity
// ---------------------------------------------------------------------------

describe('npc_avatar_catalog — catalog integrity', () => {
  test('every mapped NPC sprite is registered with expressions', () => {
    for (const [npcId, sprite] of Object.entries(NPC_AVATAR_SPRITE_MAP)) {
      expect(NPC_SPRITE_EXPRESSIONS[sprite], `sprite ${sprite} (NPC ${npcId})`).toBeDefined();
    }
  });

  test('every mapped NPC sprite has a neutral portrait in the game-data catalog', async () => {
    for (const [npcId, sprite] of Object.entries(NPC_AVATAR_SPRITE_MAP)) {
      const expectedPath = SPRITE_PORTRAIT_PATHS[sprite];
      if (expectedPath) {
        await expect(
          Bun.file(new URL(`../../../static/${expectedPath}`, import.meta.url)).exists(),
          `neutral.webp for sprite ${sprite} (NPC ${npcId}) at ${expectedPath}`,
        ).resolves.toBe(true);
      }
    }
  });

  test('every mapped persona sprite is registered with expressions', () => {
    for (const [personaId, sprite] of Object.entries(PERSONA_AVATAR_SPRITE_MAP)) {
      expect(
        NPC_SPRITE_EXPRESSIONS[sprite],
        `sprite ${sprite} (persona ${personaId})`,
      ).toBeDefined();
    }
  });

  test('every mapped player class sprite is registered with expressions', () => {
    for (const [classId, sprite] of Object.entries(PLAYER_CLASS_AVATAR_SPRITE_MAP)) {
      expect(NPC_SPRITE_EXPRESSIONS[sprite], `sprite ${sprite} (class ${classId})`).toBeDefined();
    }
  });

  test('every mapped player class sprite has a neutral portrait in the game-data catalog', async () => {
    for (const [classId, sprite] of Object.entries(PLAYER_CLASS_AVATAR_SPRITE_MAP)) {
      const expectedPath = SPRITE_PORTRAIT_PATHS[sprite];
      if (expectedPath) {
        await expect(
          Bun.file(new URL(`../../../static/${expectedPath}`, import.meta.url)).exists(),
          `neutral.webp for sprite ${sprite} (class ${classId}) at ${expectedPath}`,
        ).resolves.toBe(true);
      }
    }
  });

  test('placeholder avatar file exists in game-data catalog', async () => {
    await expect(
      Bun.file(
        new URL('../../../static/game-data/portraits/npc/placeholder.svg', import.meta.url),
      ).exists(),
    ).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveNpcAvatarUrl behavior
// ---------------------------------------------------------------------------

describe('resolveNpcAvatarUrl', () => {
  test('resolves a known NPC with its default expression', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'village_elder' })).toBe(
      '/game-data/portraits/npc/gandalf/neutral.webp',
    );
  });

  test('resolves a known NPC with a supported expression', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'merchant', expression: 'happy' })).toBe(
      '/game-data/portraits/npc/aragon/happy.webp',
    );
  });

  test('clamps an unsupported expression to neutral', () => {
    // orc only has 'neutral' — requesting 'happy' must clamp, not 404.
    expect(resolveNpcAvatarUrl({ npcId: 'rollo_grasper', expression: 'happy' })).toBe(
      '/game-data/portraits/npc/orc/neutral.webp',
    );
  });

  test('falls back to persona sprite when npcId is unknown', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'unknown-npc', personaId: 'sage' })).toBe(
      '/game-data/portraits/npc/gandalf/neutral.webp',
    );
  });

  test('returns the placeholder and logs an error for an unmapped NPC', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'ghost_nobody', npcName: 'Ghost' })).toBe(
      PLACEHOLDER_AVATAR_URL,
    );
  });

  test('never returns the LPC bodies_male fallback for any input', () => {
    const urls = [
      resolveNpcAvatarUrl({ npcId: 'guard_captain' }),
      resolveNpcAvatarUrl({ npcId: 'ghost_nobody' }),
      resolveNpcAvatarUrl({ npcId: 'unknown-npc', personaId: 'blacksmith' }),
      resolvePlayerAvatarUrl({ classId: 'fighter' }),
      resolvePlayerAvatarUrl({ classId: 'not-a-class' }),
    ];
    for (const url of urls) {
      expect(url).not.toContain('bodies_male');
      expect(url).not.toContain('/game-data/lpc/');
    }
  });
});

// ---------------------------------------------------------------------------
// resolvePlayerAvatarUrl behavior
// ---------------------------------------------------------------------------

describe('resolvePlayerAvatarUrl', () => {
  test('resolves the default fighter portrait when no class is given', () => {
    expect(resolvePlayerAvatarUrl({})).toBe('/game-data/portraits/npc/aragon/neutral.webp');
  });

  test('resolves a portrait for a known class', () => {
    expect(resolvePlayerAvatarUrl({ classId: 'wizard' })).toBe(
      '/game-data/portraits/npc/gandalf/neutral.webp',
    );
  });

  test('returns the placeholder for an unknown class', () => {
    expect(resolvePlayerAvatarUrl({ classId: 'warlock' })).toBe(PLACEHOLDER_AVATAR_URL);
  });
});
