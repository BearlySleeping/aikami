// packages/frontend/engine/src/assets/scene/native_scene.test.ts
//
// C-505 — AC-1 (native round-trip preserves the normalized result), AC-6
// (canonical hashing is deterministic and reorder-independent), AC-7 (future
// authoring formats are rejected, not executed as maps).

import { describe, expect, test } from 'bun:test';
import { SCENE_FUTURE_DOCUMENT_KINDS, SCENE_MAX_DECODED_BYTES } from '@aikami/constants';
import {
  canonicalSceneHash,
  loadNativeScene,
  parseNativeScene,
  SceneBudgetError,
  SceneUnsupportedFormatError,
  serializeScene,
} from './native_scene.ts';
import { makeTerrainScene } from './scene_test_utils.ts';

describe('native_scene', () => {
  test('round-trips a scene through serialize/parse (AC-1)', () => {
    const doc = makeTerrainScene({
      placements: [{ id: 'p1', component: 'npc', frame: 'a.png', x: 0, y: 0 }],
    });
    const json = serializeScene(doc);
    const parsed = parseNativeScene(json);
    expect(parsed.id).toBe(doc.id);
    expect(parsed.extent).toEqual(doc.extent);
    expect(parsed.surface).toEqual(doc.surface);
    expect(parsed.placements).toEqual(doc.placements);
  });

  test('rejects future authoring document kinds (AC-7)', () => {
    for (const kind of SCENE_FUTURE_DOCUMENT_KINDS) {
      const future = { ...makeTerrainScene(), kind };
      expect(() => parseNativeScene(JSON.stringify(future))).toThrow(SceneUnsupportedFormatError);
    }
  });

  test('rejects an oversized document before allocation (AC-6)', () => {
    const big = ' '.repeat(64 * 1024 * 1024 + 1);
    expect(() => parseNativeScene(big)).toThrow(SceneBudgetError);
  });

  test('cancels an oversized fetched response before decoding it (AC-6)', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(SCENE_MAX_DECODED_BYTES + 1));
      },
      cancel() {
        canceled = true;
      },
    });
    await expect(
      loadNativeScene({
        url: 'test://oversized.scene.json',
        fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SceneBudgetError);
    expect(canceled).toBe(true);
  });

  test('rejects malformed JSON with a recoverable error', () => {
    expect(() => parseNativeScene('{not json')).toThrow(/invalid JSON/);
  });

  test('canonical hash is deterministic across repeated hashing (AC-6)', async () => {
    const doc = makeTerrainScene();
    const h1 = await canonicalSceneHash(doc);
    const h2 = await canonicalSceneHash(doc);
    expect(h1).toBe(h2);
  });

  test('reordering independent object members cannot change the hash (AC-6)', async () => {
    const doc = makeTerrainScene();
    const hashA = await canonicalSceneHash(doc);
    // Same logical document, different member insertion order.
    const reordered = JSON.parse(serializeScene(doc));
    const shuffled: Record<string, unknown> = {};
    for (const key of [
      'placements',
      'navigation',
      'surface',
      'extent',
      'id',
      'assetLock',
      'kind',
      'schemaVersion',
      'layers',
    ]) {
      if (key in reordered) {
        shuffled[key] = reordered[key];
      }
    }
    const hashB = await canonicalSceneHash(shuffled as typeof doc);
    expect(hashB).toBe(hashA);
  });

  test('reordering independent placements does not change object identity (AC-6)', async () => {
    const a = makeTerrainScene({
      placements: [
        { id: 'p1', component: 'npc', frame: 'a.png', x: 0, y: 0 },
        { id: 'p2', component: 'npc', frame: 'b.png', x: 32, y: 0 },
      ],
    });
    const b = makeTerrainScene({
      placements: [
        { id: 'p2', component: 'npc', frame: 'b.png', x: 32, y: 0 },
        { id: 'p1', component: 'npc', frame: 'a.png', x: 0, y: 0 },
      ],
    });
    expect(await canonicalSceneHash(b)).toBe(await canonicalSceneHash(a));
    // Serialize + re-parse: each identity keeps its associated authored data.
    const parsed = parseNativeScene(serializeScene(b));
    expect(parsed.placements.find((placement) => placement.id === 'p1')).toMatchObject({
      id: 'p1',
      component: 'npc',
      frame: 'a.png',
      x: 0,
      y: 0,
    });
    expect(parsed.placements.find((placement) => placement.id === 'p2')).toMatchObject({
      id: 'p2',
      component: 'npc',
      frame: 'b.png',
      x: 32,
      y: 0,
    });
  });

  test('rejects an unknown document kind as unsupported', () => {
    const doc = { ...makeTerrainScene(), kind: 'aikami.mystery' };
    expect(() => parseNativeScene(JSON.stringify(doc))).toThrow(/invalid scene document/);
  });
});
