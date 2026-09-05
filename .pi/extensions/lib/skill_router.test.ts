// .pi/extensions/lib/skill_router.test.ts
//
// C-474 AC-2: Specialized skills use progressive disclosure.
// Non-engine sessions avoid the Pixi API catalogue.
// Engine sessions can discover the router and load needed files.

import { describe, expect, test } from 'bun:test';
import {
  clearPixiSkillCache,
  hasPixiSkill,
  listPixiSkills,
  loadPixiSkill,
} from './skill_router.ts';

// Resolve repoRoot for tests — the pi extension lib dir is under
// <repoRoot>/.pi/extensions/lib/
const REPO_ROOT = import.meta.dir
  ? (() => {
      // Navigate up from .pi/extensions/lib/ to repo root
      const parts = import.meta.dir.split('/');
      // Find '.pi' in the path
      const piIndex = parts.lastIndexOf('.pi');
      return parts.slice(0, piIndex).join('/');
    })()
  : process.cwd();

describe('AC-2: Skill listing', () => {
  test('lists all 26 Pixi skills', () => {
    const skills = listPixiSkills();
    expect(skills.length).toBe(26);
  });

  test('each skill has id, label, and description', () => {
    for (const skill of listPixiSkills()) {
      expect(typeof skill.id).toBe('string');
      expect(skill.id.length).toBeGreaterThan(0);
      expect(typeof skill.label).toBe('string');
      expect(typeof skill.description).toBe('string');
    }
  });

  test('includes core skills like ticker and sprites', () => {
    const ids = listPixiSkills().map((s) => s.id);
    expect(ids).toContain('pixijs-ticker');
    expect(ids).toContain('pixijs-scene-sprite');
    expect(ids).toContain('pixijs-core-concepts');
    expect(ids).toContain('pixijs-assets');
  });
});

describe('AC-2: On-demand loading', () => {
  test('loadPixiSkill returns content for a known skill', () => {
    clearPixiSkillCache();
    const content = loadPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-core-concepts' });
    expect(content).toBeDefined();
    expect(content?.length).toBeGreaterThan(0);
    // Should contain PixiJS-related content
    expect(content).toMatch(/pixi|Pixi|PIXI/i);
  });

  test('loadPixiSkill returns undefined for unknown skill', () => {
    clearPixiSkillCache();
    const content = loadPixiSkill({ repoRoot: REPO_ROOT, skillId: 'nonexistent-skill' });
    expect(content).toBeUndefined();
  });

  test('loadPixiSkill caches content after first load', () => {
    clearPixiSkillCache();
    const first = loadPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-ticker' });
    const second = loadPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-ticker' });
    expect(first).toBe(second); // Same reference (cached)
  });

  test('clearPixiSkillCache invalidates the cache', () => {
    clearPixiSkillCache();
    loadPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-scene-sprite' });
    // Should not throw
    clearPixiSkillCache();
    const reloaded = loadPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-scene-sprite' });
    expect(reloaded).toBeDefined();
  });
});

describe('AC-2: Skill existence check', () => {
  test('hasPixiSkill returns true for known skills', () => {
    expect(hasPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-core-concepts' })).toBe(true);
    expect(hasPixiSkill({ repoRoot: REPO_ROOT, skillId: 'pixijs-events' })).toBe(true);
  });

  test('hasPixiSkill returns false for unknown skills', () => {
    expect(hasPixiSkill({ repoRoot: REPO_ROOT, skillId: 'not-a-real-skill' })).toBe(false);
  });
});

describe('AC-2: Non-engine sessions avoid full catalogue', () => {
  test('router registration cost is one tool, not 26 files', () => {
    // The skill_router registers ONE tool ("load_pixi_skill") that lists
    // all 26 Pixi skills as a compact index. The full content of each skill
    // is loaded only on demand via loadPixiSkill().
    const skills = listPixiSkills();
    // Verify the index is compact: sum of IDs + labels + descriptions
    const indexSize = skills.reduce(
      (sum, s) => sum + s.id.length + s.label.length + s.description.length,
      0,
    );
    // The full Pixi catalogue is ~3,755 tokens * 4 chars/token ≈ 15,000 chars
    // The index should be significantly smaller
    expect(indexSize).toBeLessThan(5000);
  });
});
