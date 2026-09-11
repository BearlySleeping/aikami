// packages/frontend/engine/src/game_world/scene_overlays.test.ts

import { describe, expect, test } from 'bun:test';
import { Container, Rectangle, Texture, TextureSource } from 'pixi.js';
import type { TransitionZone } from '../assets/map_loader.ts';
import type { PropTextureResolution } from '../rendering/prop_texture_resolver.ts';
import {
  buildFrameUvResolver,
  drawDebugGrid,
  renderTransitionZoneOverlays,
} from './scene_overlays.ts';

const zone = (id: string): TransitionZone =>
  ({ id, x: 10, y: 20, width: 32, height: 32 }) as TransitionZone;

describe('scene_overlays — debug grid', () => {
  test('draws gridlines and replaces any previous grid', () => {
    const worldContainer = new Container();
    drawDebugGrid({ worldContainer, width: 4, height: 3, tileSize: 32 });
    expect(worldContainer.children.filter((c) => c.label === 'debug-grid')).toHaveLength(1);

    drawDebugGrid({ worldContainer, width: 2, height: 2, tileSize: 16 });
    expect(worldContainer.children.filter((c) => c.label === 'debug-grid')).toHaveLength(1);
  });
});

describe('scene_overlays — transition zones', () => {
  test('renders one labelled overlay per zone and replaces old ones', () => {
    const worldContainer = new Container();
    renderTransitionZoneOverlays({ worldContainer, zones: [zone('a'), zone('b')] });
    expect(worldContainer.getChildByLabel('zone-overlay-a')).not.toBeNull();
    expect(worldContainer.getChildByLabel('zone-overlay-b')).not.toBeNull();

    renderTransitionZoneOverlays({ worldContainer, zones: [zone('c')] });
    expect(worldContainer.getChildByLabel('zone-overlay-a')).toBeNull();
    expect(worldContainer.getChildByLabel('zone-overlay-c')).not.toBeNull();
  });

  test('handles zero zones by only clearing overlays', () => {
    const worldContainer = new Container();
    renderTransitionZoneOverlays({ worldContainer, zones: [zone('a')] });
    renderTransitionZoneOverlays({ worldContainer, zones: [] });
    expect(worldContainer.getChildByLabel('zone-overlay-a')).toBeNull();
  });
});

describe('scene_overlays — frame UV resolver', () => {
  test('returns undefined without a resolver or probe frame', () => {
    expect(buildFrameUvResolver({ probeFrame: 'x' })).toBeUndefined();
    expect(
      buildFrameUvResolver({ propFrameResolver: () => null, probeFrame: undefined }),
    ).toBeUndefined();
  });

  test('derives normalized UVs from the resolved texture frame', () => {
    const texture = new Texture({
      source: new TextureSource({ width: 64, height: 64 }),
      frame: new Rectangle(16, 32, 16, 16),
    });
    const resolution: PropTextureResolution = { texture, frame: 'probe', source: 'hit' };
    const resolver = buildFrameUvResolver({
      propFrameResolver: () => resolution,
      probeFrame: 'probe',
    });

    expect(resolver).toBeDefined();
    expect(resolver?.source).toBe(texture.source);
    expect(resolver?.resolve('probe')).toEqual({ u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75 });
  });
});
