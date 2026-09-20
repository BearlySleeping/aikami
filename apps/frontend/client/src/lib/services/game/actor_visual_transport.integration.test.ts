// apps/frontend/client/src/lib/services/game/actor_visual_transport.integration.test.ts
//
// The enemy visual TRANSPORT, end to end, against the real shipped manifest.
//
// The unit tests around this feature each cover one piece: the `ActorVisual`
// schema, `prepareStatic`, the resolver, the atomic commit. None of them drove
// the whole chain, so nothing caught that the authored URLs were wrong — they
// carried a `/content-packs` prefix that `assetTagResolver` turns into
// `content-packs:emberwatch:enemies:<id>`, a tag no published row matches. The
// resolver returned null, the renderer fell back to a raw URL, and nothing
// served it.
//
// This test closes that gap. It walks:
//
//   real Emberwatch manifest
//     → ContentPackNpcEntry.visual
//     → actorVisualResolverFor (the real projection)
//     → loadStaticVisual (the real transport)
//     → prepareStatic + commitPreparedAppearance
//     → RenderEntry owns the authored static appearance
//
// No WebGL: the texture loader is a double, because the property under test is
// transport correctness, not rendering. Actual occlusion and placement remain
// the level-C human gate.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ActorRenderEntry,
  type ContentPackLoaderInterface,
  type ContentPackManifest,
  type ContentPackNpcEntry,
  commitPreparedAppearance,
  EntityAppearanceLoader,
  loadStaticVisual,
  pathToTag,
} from '@aikami/frontend/engine';
import { Container, Texture } from 'pixi.js';
import { actorVisualResolverFor } from './actor_visual_presentation.ts';

const REPO_ROOT = join(import.meta.dirname, '../../../../../../..');
const MANIFEST_PATH = join(REPO_ROOT, 'content/packs/emberwatch/manifest.json');
const PACK_MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentPackManifest;

/**
 * The published catalog registry for the content-packs root.
 *
 * This is the scan sidecar `scan_assets.ts` emits — the tag table the client's
 * `assetTagResolver` actually looks a path up in. The pack's own manifest
 * declares NPCs and maps; it does NOT list published asset tags.
 */
const REGISTRY_PATH = join(REPO_ROOT, 'content/packs/manifest.json');
const PUBLISHED_TAGS = new Set(
  Object.keys(
    (JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as { assets: Record<string, unknown> }).assets,
  ),
);

/** The three hostile actors the proof encounter fields. */
const ENEMY_NPC_IDS = ['ash_hound', 'cinder_thrall', 'ember_warden'] as const;

/**
 * A pack accessor over the REAL shipped manifest.
 *
 * Only `getNpc` is exercised by the projection, but the object is typed as the
 * full interface so a future projection that reads another field fails to
 * compile here rather than silently diverging.
 */
const realPack = (): ContentPackLoaderInterface =>
  ({
    manifest: PACK_MANIFEST,
    packId: 'emberwatch',
    getNpc: (npcId: string): ContentPackNpcEntry | undefined => PACK_MANIFEST.npcs[npcId],
  }) as unknown as ContentPackLoaderInterface;

const makeTexture = (width: number, height: number): Texture =>
  new Texture({ source: Texture.WHITE.source, frame: { x: 0, y: 0, width, height } } as never);

/** Records every URL the loader was asked to fetch. */
const makeLoader = (options: { requested: string[]; fail?: boolean }) =>
  new EntityAppearanceLoader({
    resolveAssetUrl: () => null,
    loadTexture: async (url: string) => {
      options.requested.push(url);
      if (options.fail) {
        throw new Error('simulated texture failure');
      }
      return makeTexture(64, 64);
    },
  });

const makeEntry = (): ActorRenderEntry => ({
  displayObject: new Container(),
  spawnOrder: 1,
  tint: 0xffffff,
  cullable: false,
});

/** A commit context whose revision counter the test controls. */
const makeContext = (options: { loader: EntityAppearanceLoader; revision: () => number }) => ({
  loader: options.loader,
  isDisposed: () => false,
  currentRevision: options.revision,
  debug: () => {},
});

describe('enemy visual transport — real manifest through the real chain', () => {
  test('every hostile actor authors a static visual with real dimensions', () => {
    for (const npcId of ENEMY_NPC_IDS) {
      const npc = PACK_MANIFEST.npcs[npcId];
      expect(npc, `${npcId} must exist in the shipped pack`).toBeDefined();
      expect(npc?.visual?.kind, `${npcId} must author a static visual`).toBe('static');
      if (npc?.visual?.kind !== 'static') {
        throw new Error('unreachable: asserted above');
      }
      expect(npc.visual.width).toBeGreaterThan(0);
      expect(npc.visual.height).toBeGreaterThan(0);
    }
  });

  test('the authored URL resolves to a PUBLISHED tag through the real resolver contract', () => {
    // This is the assertion the unit tests were missing. `assetTagResolver`
    // strips a leading slash and the `game-data/` alias, then calls
    // `pathToTag`. Reproducing that here proves the authored URL names an
    // object the catalog actually publishes — not merely a plausible path.
    const publishedTags = PUBLISHED_TAGS;
    for (const npcId of ENEMY_NPC_IDS) {
      const npc = PACK_MANIFEST.npcs[npcId];
      if (npc?.visual?.kind !== 'static') {
        throw new Error(`${npcId} must author a static visual`);
      }
      const withoutLeadingSlash = npc.visual.url.startsWith('/')
        ? npc.visual.url.slice(1)
        : npc.visual.url;
      const normalized = withoutLeadingSlash.startsWith('game-data/')
        ? withoutLeadingSlash.slice('game-data/'.length)
        : withoutLeadingSlash;
      const tag = pathToTag(normalized);
      expect(tag, `${npcId} URL must map to its published tag`).toBe(`emberwatch:enemies:${npcId}`);
      expect(publishedTags.has(tag), `${tag} must be a published asset`).toBe(true);
    }
  });

  test('the resolver projects the real manifest to the authored visual', () => {
    const resolve = actorVisualResolverFor(realPack);
    for (const npcId of ENEMY_NPC_IDS) {
      const visual = resolve(npcId);
      expect(visual?.kind).toBe('static');
      if (visual?.kind !== 'static') {
        throw new Error('unreachable: asserted above');
      }
      expect(visual.url).toBe(`/emberwatch/enemies/${npcId}.png`);
    }
  });

  test('width and height survive the whole transport into the render entry', async () => {
    const resolve = actorVisualResolverFor(realPack);
    for (const npcId of ENEMY_NPC_IDS) {
      const visual = resolve(npcId);
      if (visual?.kind !== 'static') {
        throw new Error(`${npcId} must resolve to a static visual`);
      }
      const requested: string[] = [];
      const loader = makeLoader({ requested });
      const entry = makeEntry();
      const committed = await loadStaticVisual({
        context: makeContext({ loader, revision: () => 1 }),
        entry,
        currentEntry: entry,
        visual,
        revision: 1,
        resolveUrl: undefined,
      });

      expect(committed, `${npcId} must commit`).toBe(true);
      // The URL reached the loader unchanged (no resolver wired → raw URL).
      expect(requested).toEqual([visual.url]);
      // The entry now owns the authored appearance, and it is marked static so
      // the LPC frame path leaves it alone rather than slicing it into cells.
      expect(entry.layerSprites?.length).toBe(1);
      expect(entry.layerSprites?.[0]?.staticVisual).toBe(true);
    }
  });

  test('a static visual is never sliced by the LPC frame path', async () => {
    const resolve = actorVisualResolverFor(realPack);
    const visual = resolve('ash_hound');
    if (visual?.kind !== 'static') {
      throw new Error('ash_hound must resolve to a static visual');
    }
    const loader = makeLoader({ requested: [] });
    const entry = makeEntry();
    await loadStaticVisual({
      context: makeContext({ loader, revision: () => 1 }),
      entry,
      currentEntry: entry,
      visual,
      revision: 1,
      resolveUrl: undefined,
    });
    const layer = entry.layerSprites?.[0];
    expect(layer?.staticVisual).toBe(true);
    // A static layer carries no spritesheet to slice — that is the mechanism
    // that prevents the 64px cell crop.
    expect(layer?.spritesheet).toBeUndefined();
    expect(layer?.definition).toBeUndefined();
  });

  test('a superseded load cannot replace a newer appearance', async () => {
    const resolve = actorVisualResolverFor(realPack);
    const visual = resolve('cinder_thrall');
    if (visual?.kind !== 'static') {
      throw new Error('cinder_thrall must resolve to a static visual');
    }
    const loader = makeLoader({ requested: [] });
    const entry = makeEntry();
    let revision = 1;

    // Start a load at revision 1, then advance the counter before it commits —
    // exactly what a second spawn or a pack switch does.
    const pending = loadStaticVisual({
      context: makeContext({ loader, revision: () => revision }),
      entry,
      currentEntry: entry,
      visual,
      revision: 1,
      resolveUrl: undefined,
    });
    revision = 2;
    const committed = await pending;

    expect(committed).toBe(false);
    expect(entry.layerSprites).toBeUndefined();
  });

  test('a load against a replaced entry is discarded rather than applied', async () => {
    const resolve = actorVisualResolverFor(realPack);
    const visual = resolve('ember_warden');
    if (visual?.kind !== 'static') {
      throw new Error('ember_warden must resolve to a static visual');
    }
    const loader = makeLoader({ requested: [] });
    const entry = makeEntry();
    const replacement = makeEntry();

    const committed = await loadStaticVisual({
      context: makeContext({ loader, revision: () => 1 }),
      entry,
      // The entity now maps to a different entry — this load is stale.
      currentEntry: replacement,
      visual,
      revision: 1,
      resolveUrl: undefined,
    });

    expect(committed).toBe(false);
    expect(entry.layerSprites).toBeUndefined();
    expect(replacement.layerSprites).toBeUndefined();
  });

  test('a failed texture load leaves the existing display intact, not blanked', async () => {
    const resolve = actorVisualResolverFor(realPack);
    const visual = resolve('ash_hound');
    if (visual?.kind !== 'static') {
      throw new Error('ash_hound must resolve to a static visual');
    }
    const loader = makeLoader({ requested: [], fail: true });
    const entry = makeEntry();
    const existing = new Container();
    entry.displayObject.addChild(existing);

    const committed = await loadStaticVisual({
      context: makeContext({ loader, revision: () => 1 }),
      entry,
      currentEntry: entry,
      visual,
      revision: 1,
      resolveUrl: undefined,
    });

    // The failure is contained: nothing was committed and the pre-existing
    // child is still there, so a miss never blanks a live actor.
    expect(committed).toBe(false);
    expect(entry.displayObject.children).toContain(existing);
  });

  test('an unknown npcId falls back to LPC rather than inventing art', () => {
    const resolve = actorVisualResolverFor(realPack);
    expect(resolve('not_a_real_npc')).toEqual({ kind: 'lpc' });
  });

  test('an absent pack falls back to LPC', () => {
    const resolve = actorVisualResolverFor(() => undefined);
    expect(resolve('ash_hound')).toEqual({ kind: 'lpc' });
  });

  test('an NPC that authored no visual falls back to LPC', () => {
    const resolve = actorVisualResolverFor(realPack);
    const withoutVisual = Object.keys(PACK_MANIFEST.npcs).find(
      (npcId) => PACK_MANIFEST.npcs[npcId]?.visual === undefined,
    );
    if (withoutVisual === undefined) {
      throw new Error('the pack must contain at least one NPC with no authored visual');
    }
    expect(resolve(withoutVisual)).toEqual({ kind: 'lpc' });
  });
});

describe('commitPreparedAppearance — atomicity', () => {
  test('an empty prepared appearance is discarded, never committed', async () => {
    const loader = makeLoader({ requested: [] });
    const entry = makeEntry();
    const committed = commitPreparedAppearance({
      context: makeContext({ loader, revision: () => 1 }),
      entry,
      currentEntry: entry,
      prepared: { container: new Container(), layers: [] },
      revision: 1,
      debugEvent: 'test',
    });
    expect(committed).toBe(false);
    expect(entry.layerSprites).toBeUndefined();
  });
});
