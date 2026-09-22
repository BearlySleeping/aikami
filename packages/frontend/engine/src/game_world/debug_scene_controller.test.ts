// packages/frontend/engine/src/game_world/debug_scene_controller.test.ts
//
// Regression coverage for fitted-camera diagnostics exposed to embedded debug
// surfaces immediately after a synthetic scene is installed.

import { describe, expect, test } from 'bun:test';
import { DebugSceneController } from './debug_scene_controller.ts';
import type { DebugSceneSpec } from './debug_scene_overlay.ts';

const scene: DebugSceneSpec = {
  width: 8,
  height: 4,
  tileSize: 32,
  blockedCells: [],
  layers: {
    grid: true,
    coordinates: true,
    blocked: true,
    actorIds: false,
    reachable: false,
    targets: false,
    objects: true,
    worldOrigin: false,
  },
};

describe('DebugSceneController diagnostics', () => {
  test('reports the fitted camera immediately after setScene', () => {
    const controller = new DebugSceneController({
      getContainer: () => undefined,
      getScreen: () => ({ width: 800, height: 600 }),
      getApp: () => undefined,
      getCamera: () => ({ x: 10, y: 20, zoom: 0.5 }),
      getRenderer: () => 'webgl',
    });

    controller.setScene(scene);

    const fittedCamera = controller.camera;
    if (!fittedCamera) {
      throw new Error('expected setScene to fit a debug camera');
    }
    expect(controller.getDiagnostics().camera).toEqual(fittedCamera);
    expect(controller.getDiagnostics().camera).not.toEqual({ x: 10, y: 20, zoom: 0.5 });
  });

  test('falls back to the world camera before a scene has been fitted', () => {
    const controller = new DebugSceneController({
      getContainer: () => undefined,
      getScreen: () => undefined,
      getApp: () => undefined,
      getCamera: () => ({ x: 10, y: 20, zoom: 0.5 }),
      getRenderer: () => 'webgl',
    });

    expect(controller.getDiagnostics().camera).toEqual({ x: 10, y: 20, zoom: 0.5 });
  });
});
