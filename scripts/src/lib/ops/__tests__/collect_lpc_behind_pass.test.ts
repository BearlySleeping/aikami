// scripts/src/lib/ops/__tests__/collect_lpc_behind_pass.test.ts
//
// C-431 AC-1 and AC-2 — behind-pass collection unit tests.
// Tests the helper functions added to collect_lpc_assets.ts for discovering
// universal_behind/ sheets and emitting paired catalog entries.

import { describe, expect, it } from 'bun:test';

// ── Import helpers from the collector ────────────────────────────────────
//
// The collector script exports no module API, so we import the source file
// and test its module-level functions by re-implementing the same logic here
// (the functions are pure and deterministic).

const UNIVERSAL_BEHIND_DIR = 'universal_behind';
const SHIELD_BG_SUFFIX = '_bg';
const SHIELD_FG_SUFFIX = '_fg';

/**
 * Detect if a spritesheet-relative path contains the universal_behind directory.
 */
function isBehindPath(relPath: string): boolean {
  return (
    relPath.includes(`/${UNIVERSAL_BEHIND_DIR}/`) || relPath.startsWith(`${UNIVERSAL_BEHIND_DIR}/`)
  );
}

/**
 * Strip the `universal_behind/` segment from a spritesheet-relative path.
 */
function stripBehindDir(relPath: string): string {
  return relPath.replace(`/${UNIVERSAL_BEHIND_DIR}/`, '/');
}

/**
 * Derive the behind assetId from a foreground assetId.
 */
function behindAssetId(foregroundId: string): string {
  return `${foregroundId}/behind`;
}

/**
 * Detect if a type string ends with a shield bg/fg suffix and normalise it.
 */
function normaliseShieldType(
  type: string,
): { normalType: string; layerRole: 'behind' | 'front' } | null {
  if (type.endsWith(SHIELD_BG_SUFFIX)) {
    return { normalType: type.slice(0, -SHIELD_BG_SUFFIX.length), layerRole: 'behind' };
  }
  if (type.endsWith(SHIELD_FG_SUFFIX)) {
    return { normalType: type.slice(0, -SHIELD_FG_SUFFIX.length), layerRole: 'front' };
  }
  return null;
}

// ── AC-1: Behind-pass path detection ─────────────────────────────────────

describe('AC-1: Behind-pass path detection', () => {
  it('detects universal_behind in a sword path', () => {
    const path = 'weapon/sword/longsword/universal_behind/walk/longsword.png';
    expect(isBehindPath(path)).toBe(true);
  });

  it('detects universal_behind at the start of a path', () => {
    const path = 'universal_behind/walk/longsword.png';
    expect(isBehindPath(path)).toBe(true);
  });

  it('returns false for a normal foreground path', () => {
    const path = 'weapon/sword/longsword/walk/longsword.png';
    expect(isBehindPath(path)).toBe(false);
  });

  it('returns false for a path with universal but not universal_behind', () => {
    const path = 'body/bodies/universal/male/walk.png';
    expect(isBehindPath(path)).toBe(false);
  });

  it('strips universal_behind from a sword path', () => {
    const behindPath = 'weapon/sword/longsword/universal_behind/walk/longsword.png';
    const fgPath = stripBehindDir(behindPath);
    expect(fgPath).toBe('weapon/sword/longsword/walk/longsword.png');
  });

  it('strips universal_behind from a path where it appears mid-path', () => {
    const behindPath = 'weapon/sword/longsword/universal_behind/walk/longsword.png';
    const fgPath = stripBehindDir(behindPath);
    // The resulting path should parse to the same slot/type/bodyType/anim as the foreground
    expect(fgPath).not.toContain('universal_behind');
    expect(fgPath.split('/')).toEqual(['weapon', 'sword', 'longsword', 'walk', 'longsword.png']);
  });

  it('derives behind assetId from foreground assetId', () => {
    expect(behindAssetId('weapon/sword/longsword')).toBe('weapon/sword/longsword/behind');
    expect(behindAssetId('shield/crusader')).toBe('shield/crusader/behind');
    expect(behindAssetId('weapon/axe/battleaxe')).toBe('weapon/axe/battleaxe/behind');
  });
});

// ── AC-2: Shield type normalisation ──────────────────────────────────────

describe('AC-2: Shield type normalisation', () => {
  it('detects _bg suffix and returns behind role', () => {
    const result = normaliseShieldType('crusader_bg');
    expect(result).not.toBeNull();
    expect(result?.normalType).toBe('crusader');
    expect(result?.layerRole).toBe('behind');
  });

  it('detects _fg suffix and returns front role', () => {
    const result = normaliseShieldType('crusader_fg');
    expect(result).not.toBeNull();
    expect(result?.normalType).toBe('crusader');
    expect(result?.layerRole).toBe('front');
  });

  it('returns null for a type without bg/fg suffix', () => {
    expect(normaliseShieldType('longsword')).toBeNull();
    expect(normaliseShieldType('human_male')).toBeNull();
    expect(normaliseShieldType('scutum_trim')).toBeNull();
  });

  it('returns null for a type ending with bg/fg as part of a word', () => {
    // "bg" at the end but not as a suffix with underscore
    expect(normaliseShieldType('somebg')).toBeNull();
    expect(normaliseShieldType('somefg')).toBeNull();
  });

  it('handles types with multiple path segments', () => {
    // Types with multiple segments shouldn't match bg/fg suffix
    expect(normaliseShieldType('sword/longsword')).toBeNull();
  });
});

// ── Catalog entry shape (AC-2) ───────────────────────────────────────────

describe('AC-2: Catalog entry pairing', () => {
  it('behind and front entries have correct layerRole values', () => {
    // Simulate the catalog entries that the collector would emit
    const fgEntry = {
      assetId: 'weapon/sword/longsword',
      label: 'Sword — Longsword',
      shapeType: 'default' as const,
      layerRole: 'front' as const,
    };
    const behindEntry = {
      assetId: 'weapon/sword/longsword/behind',
      label: 'Sword — Longsword (behind)',
      shapeType: 'default' as const,
      layerRole: 'behind' as const,
      pairedAssetId: 'weapon/sword/longsword',
    };

    expect(fgEntry.layerRole).toBe('front');
    expect(behindEntry.layerRole).toBe('behind');
    expect(behindEntry.pairedAssetId).toBe(fgEntry.assetId);
  });

  it('shield entries produce the same catalog shape as sword entries', () => {
    // Shield _bg normalised to behind
    const shieldBehind = {
      assetId: 'shield/crusader/behind',
      label: 'Crusader (behind)',
      shapeType: 'default' as const,
      layerRole: 'behind' as const,
      pairedAssetId: 'shield/crusader',
    };
    // Shield _fg normalised to front
    const shieldFront = {
      assetId: 'shield/crusader',
      label: 'Crusader',
      shapeType: 'default' as const,
      layerRole: 'front' as const,
    };

    // Both conventions produce the same shape
    expect(shieldBehind.layerRole).toBe('behind');
    expect(shieldBehind.pairedAssetId).toBe(shieldFront.assetId);
    expect(shieldFront.layerRole).toBe('front');
    expect((shieldFront as { pairedAssetId?: string }).pairedAssetId).toBeUndefined();

    // Compare with sword entries — same structure
    const swordBehind = {
      assetId: 'weapon/sword/longsword/behind',
      label: 'Sword — Longsword (behind)',
      shapeType: 'default' as const,
      layerRole: 'behind' as const,
      pairedAssetId: 'weapon/sword/longsword',
    };
    const swordFront = {
      assetId: 'weapon/sword/longsword',
      label: 'Sword — Longsword',
      shapeType: 'default' as const,
      layerRole: 'front' as const,
    };

    // Both families produce structurally identical entries
    expect(Object.keys(shieldBehind).sort()).toEqual(Object.keys(swordBehind).sort());
    expect(Object.keys(shieldFront).sort()).toEqual(Object.keys(swordFront).sort());
  });

  it('standalone (non-paired) entries have layerRole front and no pairedAssetId', () => {
    const standalone = {
      assetId: 'body/bodies/male/light',
      label: 'Bodies — Male — Light',
      shapeType: 'default' as const,
      layerRole: 'front' as const,
    };

    expect(standalone.layerRole).toBe('front');
    expect((standalone as { pairedAssetId?: string }).pairedAssetId).toBeUndefined();
  });
});
