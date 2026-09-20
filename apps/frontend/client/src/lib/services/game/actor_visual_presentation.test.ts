// apps/frontend/client/src/lib/services/game/actor_visual_presentation.test.ts
//
// Enemy visual transport: a combatant carries an AUTHORED npcId, and the main
// thread turns that id into the pack's own visual.
//
// The mechanical combat state never learns an asset URL — that is the whole
// point of the split — so the only thing that can regress invisibly is this
// projection. These tests pin it against the REAL shipped pack, not a fixture
// that could drift away from what the release publishes.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentPackLoaderInterface } from '@aikami/frontend/engine';
import { actorVisualResolverFor } from './actor_visual_presentation.ts';

/** The LPC default a pack actor has when nothing else is authored. */
const LPC_FALLBACK_VISUAL = { kind: 'lpc' } as const;

const REPO_ROOT = join(import.meta.dir, '../../../../../../..');
const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, 'content/packs/emberwatch/manifest.json'), 'utf8'),
) as {
  npcs: Record<
    string,
    { visual?: { kind: string; url?: string; width?: number; height?: number } }
  >;
  encounters: Record<string, { enemyNpcIds: string[] }>;
};

/** The smallest loader that can answer `getNpc` — the resolver reads nothing else. */
const loaderFor = (npcs: Record<string, unknown>): ContentPackLoaderInterface =>
  ({ getNpc: (npcId: string) => npcs[npcId] }) as unknown as ContentPackLoaderInterface;

describe('the actor visual resolver — authored visual, or the explicit LPC fallback', () => {
  test('an authored static visual resolves as authored', () => {
    const resolve = actorVisualResolverFor(() =>
      loaderFor({
        hound: {
          name: 'Hound',
          visual: { kind: 'static', url: '/enemies/hound.png', width: 8, height: 8 },
        },
      }),
    );
    expect(resolve('hound')).toEqual({
      kind: 'static',
      url: '/enemies/hound.png',
      width: 8,
      height: 8,
    });
  });

  test('an authored lpc visual resolves to the LPC path', () => {
    const resolve = actorVisualResolverFor(() =>
      loaderFor({ guard: { name: 'Guard', visual: { kind: 'lpc' } } }),
    );
    expect(resolve('guard')).toEqual({ kind: 'lpc' });
  });

  test('an NPC that authors no visual follows the explicit LPC fallback', () => {
    const resolve = actorVisualResolverFor(() => loaderFor({ villager: { name: 'Villager' } }));
    expect(resolve('villager')).toEqual(LPC_FALLBACK_VISUAL);
  });

  test('an unknown npcId follows the LPC fallback rather than inventing art', () => {
    const resolve = actorVisualResolverFor(() => loaderFor({}));
    expect(resolve('ghost')).toEqual(LPC_FALLBACK_VISUAL);
  });

  test('no loaded pack falls back to LPC rather than throwing', () => {
    const resolve = actorVisualResolverFor(() => undefined);
    expect(resolve('hound')).toEqual(LPC_FALLBACK_VISUAL);
  });
});

describe('the resolver follows the LIVE pack, never a captured one', () => {
  test('a pack swapped after the resolver was wired is the one that answers', () => {
    let current = loaderFor({
      hound: { name: 'Hound', visual: { kind: 'static', url: '/a.png', width: 1, height: 1 } },
    });
    // Exactly how the composition roots wire it: a live accessor.
    const resolve = actorVisualResolverFor(() => current);
    expect(resolve('hound')).toEqual({ kind: 'static', url: '/a.png', width: 1, height: 1 });

    // A remount/reload replaces the pack. Capturing the loader at construction
    // time would keep serving the old art — the identity must follow the pack.
    current = loaderFor({
      hound: { name: 'Hound', visual: { kind: 'static', url: '/b.png', width: 2, height: 2 } },
    });
    expect(resolve('hound')).toEqual({ kind: 'static', url: '/b.png', width: 2, height: 2 });
  });

  test('the resolver is total: an unknown id yields the LPC visual, never a throw', () => {
    const resolve = actorVisualResolverFor(() => loaderFor({}));
    expect(resolve('nobody')).toEqual(LPC_FALLBACK_VISUAL);
  });
});

describe('the shipped proof encounter resolves authored static visuals', () => {
  const resolve = actorVisualResolverFor(() => loaderFor(manifest.npcs));
  const proofEncounter = manifest.encounters.proof_encounter;

  test('the proof encounter still declares its three enemies', () => {
    expect(proofEncounter?.enemyNpcIds).toEqual(['ash_hound', 'cinder_thrall', 'ember_warden']);
  });

  for (const npcId of ['ash_hound', 'cinder_thrall', 'ember_warden']) {
    test(`${npcId} resolves an authored static visual`, () => {
      const visual = resolve(npcId);
      expect(visual?.kind).toBe('static');
      if (visual?.kind !== 'static') {
        throw new Error('unreachable: asserted above');
      }
      // The URL must be the pack's own published path, not a foreign host.
      expect(visual.url).toContain(`/content-packs/emberwatch/enemies/${npcId}.png`);
      expect(visual.width).toBeGreaterThan(0);
      expect(visual.height).toBeGreaterThan(0);
    });
  }

  test('every other NPC keeps the LPC path', () => {
    const others = Object.keys(manifest.npcs).filter(
      (npcId) => !proofEncounter?.enemyNpcIds.includes(npcId),
    );
    for (const npcId of others) {
      expect(resolve(npcId)).toEqual({ kind: 'lpc' });
    }
  });
});
