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
const EMBERWATCH_NPC_IDS = [
  'village_elder',
  'guard_captain',
  'traveling_merchant',
  'elara_wayfinder',
  'kade_blackthorn',
  'shrine_spirit',
] as const;

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

  test('every emberwatch NPC portrait file exists on disk', async () => {
    for (const npcId of EMBERWATCH_NPC_IDS) {
      const url = resolveNpcAvatarUrl({ npcId });
      const filePath = url.replace('/assets/npc/', 'assets/npc/');
      await expect(
        Bun.file(new URL(`../../../static/${filePath}`, import.meta.url)).exists(),
        `portrait file ${filePath} should exist for NPC ${npcId}`,
      ).resolves.toBe(true);
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
  test('every mapped NPC sprite is registered with expressions and a neutral portrait', async () => {
    for (const [npcId, sprite] of Object.entries(NPC_AVATAR_SPRITE_MAP)) {
      expect(NPC_SPRITE_EXPRESSIONS[sprite], `sprite ${sprite} (NPC ${npcId})`).toBeDefined();
      await expect(
        Bun.file(
          new URL(`../../../static/assets/npc/${sprite}/neutral.webp`, import.meta.url),
        ).exists(),
        `neutral.webp for sprite ${sprite} (NPC ${npcId})`,
      ).resolves.toBe(true);
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

  test('every mapped player class sprite is registered with expressions and a neutral portrait', async () => {
    for (const [classId, sprite] of Object.entries(PLAYER_CLASS_AVATAR_SPRITE_MAP)) {
      expect(NPC_SPRITE_EXPRESSIONS[sprite], `sprite ${sprite} (class ${classId})`).toBeDefined();
      await expect(
        Bun.file(
          new URL(`../../../static/assets/npc/${sprite}/neutral.webp`, import.meta.url),
        ).exists(),
        `neutral.webp for sprite ${sprite} (class ${classId})`,
      ).resolves.toBe(true);
    }
  });

  test('placeholder avatar file exists', async () => {
    await expect(
      Bun.file(new URL('../../../static/assets/npc/placeholder.svg', import.meta.url)).exists(),
    ).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveNpcAvatarUrl behavior
// ---------------------------------------------------------------------------

describe('resolveNpcAvatarUrl', () => {
  test('resolves a known NPC with its default expression', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'guard_captain' })).toBe('/assets/npc/aragon/neutral.webp');
  });

  test('resolves a known NPC with a supported expression', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'guard_captain', expression: 'happy' })).toBe(
      '/assets/npc/aragon/happy.webp',
    );
  });

  test('clamps an unsupported expression to neutral', () => {
    // orc only has 'neutral' — requesting 'happy' must clamp, not 404.
    expect(resolveNpcAvatarUrl({ npcId: 'kade_blackthorn', expression: 'happy' })).toBe(
      '/assets/npc/orc/neutral.webp',
    );
  });

  test('falls back to persona sprite when npcId is unknown', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'unknown-npc', personaId: 'sage' })).toBe(
      '/assets/npc/gandalf/neutral.webp',
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
    expect(resolvePlayerAvatarUrl({})).toBe('/assets/npc/aragon/neutral.webp');
  });

  test('resolves a portrait for a known class', () => {
    expect(resolvePlayerAvatarUrl({ classId: 'wizard' })).toBe('/assets/npc/gandalf/neutral.webp');
  });

  test('returns the placeholder for an unknown class', () => {
    expect(resolvePlayerAvatarUrl({ classId: 'warlock' })).toBe(PLACEHOLDER_AVATAR_URL);
  });
});
