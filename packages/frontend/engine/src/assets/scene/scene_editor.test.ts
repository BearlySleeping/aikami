// packages/frontend/engine/src/assets/scene/scene_editor.test.ts
//
// C-507 — Editor core: load (AC-1), ground/collision (AC-2), placement and
// transition edits (AC-3), undo/redo (AC-4), native round-trip (AC-5) and
// offline manifest parsing (AC-6).

import { describe, expect, test } from 'bun:test';
import type { SceneDocument } from '@aikami/types';
import { parseNativeScene, serializeScene } from './native_scene.ts';
import {
  createSceneEditor,
  createSceneEditorFromManifest,
  sceneDocumentFromManifest,
  sceneDocumentToTilemap,
  sceneTilesetsFromManifest,
} from './scene_editor.ts';
import { sceneFromTilemap } from './scene_loader.ts';
import { makeBakedScene, makeTerrainScene } from './scene_test_utils.ts';

describe('scene_editor — AC-1 load', () => {
  test('wraps a validated document and deep-clones it', () => {
    const source = makeBakedScene();
    const sourceGrid = source.surface.mode === 'baked' ? [...source.surface.grid] : [];
    const editor = createSceneEditor(source);
    editor.paintGround(0, 0, 'brand_new.png');
    editor.toggleCollision(3, 1, true);
    // The caller's document must not be mutated by editor operations.
    const after = source.surface.mode === 'baked' ? source.surface.grid : [];
    expect(after).toEqual(sourceGrid);
    expect(source.navigation.blockingOverrides).toBeUndefined();
    expect(editor.canUndo).toBe(true);
  });

  test('rejects an invalid document at construction', () => {
    const invalid = makeBakedScene() as SceneDocument;
    // Corrupt the grid length to violate the width×height invariant.
    if (invalid.surface.mode === 'baked') {
      invalid.surface.grid = [1];
    }
    expect(() => createSceneEditor(invalid)).toThrow();
  });

  test('parses a native scene manifest without network (AC-6)', () => {
    const text = JSON.stringify(makeTerrainScene());
    const doc = sceneDocumentFromManifest(text);
    expect(doc.kind).toBe('aikami.scene');
    expect(doc.surface.mode).toBe('terrain');
  });

  test('parses a legacy Tiled manifest through the adapter (AC-6)', () => {
    const legacy = {
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          columns: 4,
          image: 'debug_tiles.png',
          imageheight: 32,
          imagewidth: 128,
          margin: 0,
          name: 'debug_tiles',
          spacing: 0,
          tilecount: 4,
          tilewidth: 32,
          tileheight: 32,
        },
      ],
      layers: [
        {
          name: 'ground',
          type: 'tilelayer',
          width: 2,
          height: 2,
          data: [1, 2, 0, 1],
          visible: true,
        },
      ],
    };
    const editor = createSceneEditorFromManifest(JSON.stringify(legacy), {
      sceneId: 'legacy',
    });
    const surface = editor.document.surface;
    expect(surface.mode).toBe('baked');
    if (surface.mode === 'baked') {
      expect(surface.palette).toContain('debug_tiles_0.png');
      expect(surface.grid[0]).toBeGreaterThan(0);
    }
  });
});

describe('scene_editor — AC-2 ground and collision', () => {
  test('paints an existing baked frame and appends a new one', () => {
    const editor = createSceneEditor(makeBakedScene());
    const first = editor.paintGround(0, 1, 'floor.png');
    expect(first.ok && first.changed).toBe(true);
    const appended = editor.paintGround(1, 0, 'new_floor.png');
    expect(appended.ok).toBe(true);
    const surface = editor.document.surface;
    expect(surface.mode).toBe('baked');
    if (surface.mode === 'baked') {
      expect(surface.palette).toContain('new_floor.png');
      expect(surface.grid[2]).toBe(1); // (0,1) painted with the existing frame
      expect(surface.grid[1]).toBe(surface.palette.length - 1);
    }
  });

  test('erasing clears to the reserved empty index without growing the palette', () => {
    const editor = createSceneEditor(makeBakedScene());
    const before =
      editor.document.surface.mode === 'baked' ? editor.document.surface.palette.length : 0;
    editor.paintGround(1, 1, 0);
    const surface = editor.document.surface;
    if (surface.mode === 'baked') {
      expect(surface.grid[3]).toBe(0);
      expect(surface.palette.length).toBe(before);
    }
  });

  test('rejects an out-of-range cell without mutating the document', () => {
    const editor = createSceneEditor(makeBakedScene());
    const result = editor.paintGround(9, 9, 'floor.png');
    expect(result.ok).toBe(false);
    expect(editor.canUndo).toBe(false);
  });

  test('paints a terrain cell and erases to the default terrain', () => {
    const editor = createSceneEditor(makeTerrainScene());
    editor.paintGround(0, 0, 'water');
    let surface = editor.document.surface;
    if (surface.mode === 'terrain') {
      expect(surface.cells[0]).toBe('water');
    }
    editor.paintGround(0, 0, 0);
    surface = editor.document.surface;
    if (surface.mode === 'terrain') {
      expect(surface.cells[0]).toBe('grass');
    }
  });

  test('toggles collision without duplicating overrides', () => {
    const editor = createSceneEditor(makeBakedScene());
    editor.toggleCollision(0, 0, true);
    editor.toggleCollision(0, 0, true); // no-op, second call
    let overrides = editor.document.navigation.blockingOverrides ?? [];
    expect(overrides.length).toBe(1);
    editor.toggleCollision(0, 0, false);
    overrides = editor.document.navigation.blockingOverrides ?? [];
    expect(overrides.length).toBe(1);
    expect(overrides[0]?.blocked).toBe(false);
  });
});

describe('scene_editor — AC-3 placements and transitions', () => {
  test('adds, moves and removes a placement by stable id', () => {
    const editor = createSceneEditor(makeBakedScene());
    const added = editor.addPlacement({ component: 'prop', frame: 'oak.png', x: 32, y: 64 });
    expect(added.ok).toBe(true);
    const placement = editor.document.placements[0];
    expect(placement).toBeDefined();
    const id = placement?.id ?? '';
    expect(editor.document.placements.length).toBe(1);

    editor.movePlacement(id, 64, 96);
    const moved = editor.document.placements[0];
    expect(moved?.x).toBe(64);
    expect(moved?.y).toBe(96);
    expect(moved?.id).toBe(id); // identity survives a move (C-505 AC-3)

    editor.removePlacement(id);
    expect(editor.document.placements.length).toBe(0);
    expect(editor.selection).toBeUndefined();
  });

  test('generates collision-free ids across add/remove', () => {
    const editor = createSceneEditor(makeBakedScene());
    editor.addPlacement({ component: 'prop', frame: 'a.png', x: 0, y: 0 });
    const firstId = editor.document.placements[0]?.id;
    editor.removePlacement(firstId ?? '');
    editor.addPlacement({ component: 'prop', frame: 'b.png', x: 0, y: 0 });
    // Re-adding must reuse the freed slot deterministically.
    expect(editor.document.placements[0]?.id).toBe(firstId);
  });

  test('rejects a duplicate explicit placement id', () => {
    const editor = createSceneEditor(makeBakedScene());
    editor.addPlacement({ component: 'prop', frame: 'a.png', x: 0, y: 0, id: 'dup' });
    const second = editor.addPlacement({
      component: 'prop',
      frame: 'b.png',
      x: 0,
      y: 0,
      id: 'dup',
    });
    expect(second.ok).toBe(false);
  });

  test('adds and removes a transition and selects it by id', () => {
    const editor = createSceneEditor(makeBakedScene());
    const added = editor.addTransition({ x: 0, y: 0, targetMap: 'inn' });
    expect(added.ok).toBe(true);
    const transition = editor.document.transitions?.[0];
    expect(transition?.targetMap).toBe('inn');
    expect(transition?.width).toBe(32);
    editor.select({ kind: 'transition', id: transition?.id ?? '' });
    expect(editor.selection).toEqual({ kind: 'transition', id: transition?.id ?? '' });
    editor.removeTransition(transition?.id ?? '');
    expect(editor.document.transitions?.length ?? 0).toBe(0);
  });
});

describe('scene_editor — AC-4 undo/redo', () => {
  test('round-trips an edit sequence', () => {
    const editor = createSceneEditor(makeBakedScene());
    expect(editor.canUndo).toBe(false);
    editor.paintGround(0, 0, 'floor_a.png');
    editor.toggleCollision(1, 0, true);
    editor.addPlacement({ component: 'prop', frame: 'oak.png', x: 16, y: 16 });
    expect(editor.historyDepth).toBe(3);

    expect(editor.undo()).toBe(true);
    expect(editor.document.placements.length).toBe(0);
    expect(editor.canRedo).toBe(true);
    expect(editor.redo()).toBe(true);
    expect(editor.document.placements.length).toBe(1);

    editor.undo();
    editor.undo();
    editor.undo();
    expect(editor.canUndo).toBe(false);
    expect(editor.dirty).toBe(false);

    editor.redo();
    editor.redo();
    editor.redo();
    expect(editor.document.placements.length).toBe(1);
    expect(editor.document.navigation.blockingOverrides?.length).toBe(1);
  });

  test('drops the oldest snapshot when history exceeds the cap', () => {
    const editor = createSceneEditor(makeBakedScene());
    for (let i = 0; i < 60; i++) {
      editor.paintGround(0, 0, `frame_${i}.png`);
    }
    expect(editor.historyDepth).toBe(50);
    expect(editor.canRedo).toBe(false);
  });

  test('clearHistory disables undo and redo', () => {
    const editor = createSceneEditor(makeBakedScene());
    editor.paintGround(0, 0, 'floor.png');
    editor.clearHistory();
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.dirty).toBe(false);
  });
});

describe('scene_editor — AC-5 native export round-trip', () => {
  test('serializes to a document that parses back identically', () => {
    const editor = createSceneEditor(makeBakedScene());
    editor.paintGround(0, 0, 'floor_a.png');
    editor.toggleCollision(2, 1, true);
    editor.addPlacement({ component: 'prop', frame: 'oak.png', x: 48, y: 16 });
    editor.addTransition({ x: 0, y: 32, targetMap: 'inn' });

    const text = editor.serialize();
    const parsed = parseNativeScene(text);
    expect(parsed.extent).toEqual(editor.document.extent);
    expect(parsed.placements).toEqual(editor.document.placements);
    expect(parsed.navigation).toEqual(editor.document.navigation);
    expect(parsed.transitions).toEqual(editor.document.transitions);
  });

  test('refuses to serialize an invalid document', () => {
    const editor = createSceneEditor(makeBakedScene());
    // Force an out-of-range palette index behind the editor's back.
    const doc = editor.document;
    if (doc.surface.mode === 'baked') {
      doc.surface.grid[0] = 99;
    }
    expect(() => editor.serialize()).toThrow();
    expect(editor.validate().length).toBeGreaterThan(0);
  });
});

describe('scene_editor — preview bridge', () => {
  const tilesets = [
    {
      firstgid: 1,
      columns: 4,
      image: 'debug_tiles.png',
      imageheight: 32,
      imagewidth: 128,
      margin: 0,
      name: 'debug_tiles',
      spacing: 0,
      tilecount: 4,
      tilewidth: 32,
      tileheight: 32,
    },
  ];

  test('sceneTilesetsFromManifest returns [] for native and parses legacy', () => {
    expect(sceneTilesetsFromManifest(serializeScene(makeBakedScene()))).toEqual([]);
    const legacy = {
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      tilesets,
      layers: [
        {
          name: 'ground',
          type: 'tilelayer',
          width: 2,
          height: 2,
          data: [1, 2, 0, 1],
          visible: true,
        },
      ],
    };
    expect(sceneTilesetsFromManifest(JSON.stringify(legacy))).toHaveLength(1);
  });

  test('sceneDocumentToTilemap preserves frames, collision and entities', () => {
    const editor = createSceneEditor(makeBakedScene());
    editor.paintGround(0, 0, 'debug_tiles_0.png');
    editor.toggleCollision(1, 0, true);
    editor.addPlacement({ component: 'prop', frame: 'oak.png', x: 0, y: 32 });
    editor.addTransition({ x: 0, y: 0, targetMap: 'inn' });

    const tilemap = sceneDocumentToTilemap(editor.document, tilesets);
    expect(tilemap.tilesets).toHaveLength(1);
    const ground = tilemap.layers.find((layer) => layer.name === 'ground');
    expect(ground?.frames?.[0]).toBe('debug_tiles_0.png');
    const collision = tilemap.layers.find((layer) => layer.name === 'collision');
    expect(collision?.data[1]).toBe(1);
    expect(tilemap.objectLayers?.[0]?.objects.length).toBe(2);

    // The reconstructed tilemap re-adapts to an equivalent document.
    const reparsed = sceneFromTilemap(tilemap, {
      sceneId: 'studio',
      assetLock: 'pack:emberwatch',
    });
    expect(reparsed.doc.placements).toHaveLength(1);
    expect(reparsed.doc.transitions?.[0]?.targetMap).toBe('inn');
    expect(reparsed.doc.navigation.blockingOverrides?.[0]).toEqual({ index: 1, blocked: true });
  });
});
