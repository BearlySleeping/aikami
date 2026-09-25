// packages/frontend/engine/src/game_world/content_identity_overlay.test.ts

import { describe, expect, test } from 'bun:test';
import type { ContentIdentitySnapshot } from '@aikami/types';
import { Container } from 'pixi.js';
import { drawContentIdentityOverlay } from './content_identity_overlay.ts';

const identity: ContentIdentitySnapshot = {
  packId: 'emberwatch',
  packName: 'Emberwatch: The Fading Ward',
  version: '5.0.0',
  updatedAt: '2026-09-18T00:00:00.000Z',
  manifestSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  atlasTextureUrl: '/game-data/sprites/tilesets/atlas.webp',
  atlasSpritesheetUrl: '/game-data/sprites/tilesets/atlas.json',
  propAtlases: [
    {
      textureUrl: '/game-data/sprites/tilesets/props.webp',
      spritesheetUrl: '/game-data/sprites/tilesets/props.json',
    },
  ],
  provenanceSource: 'generated:gpt',
  releaseId: 'release-local',
  releaseSource: 'local-candidate',
  packLockSource: 'catalog',
  lockedAssetCount: 42,
};

describe('content identity overlay', () => {
  test('draws one screen-fixed labelled panel in the explicit dev mode', () => {
    const container = new Container();
    drawContentIdentityOverlay({ container, enabled: true, identity });

    const panels = container.children.filter((child) => child.label === 'content-identity-panel');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.x).toBe(12);
    expect(panels[0]?.y).toBe(12);
  });

  test('replaces stale content and clears when disabled or unavailable', () => {
    const container = new Container();
    drawContentIdentityOverlay({ container, enabled: true, identity });
    drawContentIdentityOverlay({
      container,
      enabled: true,
      identity: { ...identity, version: '5.0.1' },
    });
    expect(
      container.children.filter((child) => child.label === 'content-identity-panel'),
    ).toHaveLength(1);

    drawContentIdentityOverlay({ container, enabled: false, identity });
    expect(container.getChildByLabel('content-identity-panel')).toBeNull();

    drawContentIdentityOverlay({ container, enabled: true });
    expect(container.getChildByLabel('content-identity-panel')).toBeNull();
  });
});
