// apps/frontend/client/src/lib/data/starter_hero_recipes.test.ts
//
// Data test for C-498 AC-3: every shipped starter hero must resolve a real
// portrait (a non-empty set of LPC layer recipes from its C-504 appearance
// identity), so no empty placeholder frame or hard-coded emoji stands in for
// a portrait in the creation flow.
//
// Run with:
//   bun run test:unit -- src/lib/data/starter_hero_recipes.test.ts

import { describe, expect, test } from 'bun:test';

import { STARTER_HEROES } from '@aikami/constants';
import { buildStarterHeroRecipes, STARTER_ENGINE_SLOTS } from './starter_hero_recipes';

describe('starter hero portraits — C-498 AC-3', () => {
  test('every shipped starter hero has an LPC recipe', () => {
    expect(STARTER_HEROES.length).toBeGreaterThan(0);
    for (const hero of STARTER_HEROES) {
      expect(Object.keys(hero.lpcRecipe).length).toBeGreaterThan(0);
    }
  });

  test('every starter hero resolves a real non-empty portrait recipe set', () => {
    expect(STARTER_HEROES.length).toBeGreaterThan(0);
    for (const hero of STARTER_HEROES) {
      const recipes = buildStarterHeroRecipes(hero);
      // A portrait must compose at least the canonical body/head/facing slots.
      expect(recipes.length, `${hero.id} resolved no layers`).toBeGreaterThan(0);
      // Every recipe carries an assetId and a palette LUT (no dead strings).
      for (const recipe of recipes) {
        expect(
          recipe.assetId.length,
          `${hero.id} ${recipe.slot} has empty assetId`,
        ).toBeGreaterThan(0);
        expect(recipe.hexPalette.byteLength, `${hero.id} ${recipe.slot} missing palette`).toBe(
          1024,
        );
      }
    }
  });

  test('every shipped hero covers the core visual slots (head, body, hair, torso, legs, feet)', () => {
    const core = ['head', 'body', 'hair', 'torso', 'legs', 'feet'];
    expect(STARTER_HEROES.length).toBeGreaterThan(0);
    for (const hero of STARTER_HEROES) {
      for (const slot of core) {
        expect(hero.lpcRecipe[slot], `${hero.id} missing ${slot}`).toBeTruthy();
      }
    }
  });

  test('engine slot ordering is canonical and stable', () => {
    expect(STARTER_ENGINE_SLOTS).toContain('body');
    expect(STARTER_ENGINE_SLOTS.indexOf('body')).toBeLessThan(STARTER_ENGINE_SLOTS.indexOf('head'));
  });

  test('invalid hex colors use the all-zero fallback palette', () => {
    const [recipe] = buildStarterHeroRecipes({
      ...STARTER_HEROES[0],
      paletteOverrides: { body: '0g0000' },
    });

    expect(recipe?.hexPalette.every((channel) => channel === 0)).toBe(true);
  });
});
