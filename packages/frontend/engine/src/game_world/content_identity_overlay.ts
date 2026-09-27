// packages/frontend/engine/src/game_world/content_identity_overlay.ts

import type { ContentIdentitySnapshot } from '@aikami/types';
import { Container, Graphics, Text } from 'pixi.js';
import { isContentIdentityOverlayMode, readContentIdentity } from './diagnostics.ts';

const PANEL_X = 12;
const PANEL_Y = 12;
const PANEL_WIDTH = 460;
const LINE_HEIGHT = 15;
const PADDING = 10;

const shortDigest = (digest: string): string => `${digest.slice(0, 12)}…${digest.slice(-8)}`;

/** Replaces the screen-fixed loaded-content panel; disabled calls remove stale output. */
export const drawContentIdentityOverlay = (options: {
  container: Container;
  enabled?: boolean;
  identity?: ContentIdentitySnapshot;
}): void => {
  const stale = options.container.children.filter(
    (child) => child.label === 'content-identity-panel',
  );
  for (const child of stale) {
    options.container.removeChild(child);
    child.destroy({ children: true });
  }

  const identity = options.identity ?? readContentIdentity();
  if (!(options.enabled ?? isContentIdentityOverlayMode()) || identity === undefined) {
    return;
  }

  const lines = [
    `content · ${identity.packId}@${identity.version}`,
    `manifest · ${shortDigest(identity.manifestSha256)}`,
    `atlas · ${identity.atlasTextureUrl ?? 'unavailable'}`,
    `release · ${identity.releaseId ?? 'unavailable'} (${identity.releaseSource ?? 'unknown'})`,
    `pack lock · ${identity.packLockSource ?? 'absent'} (${identity.lockedAssetCount ?? 0} assets)`,
    `provenance · ${identity.provenanceSource}`,
  ];
  const panel = new Container({ label: 'content-identity-panel', x: PANEL_X, y: PANEL_Y });
  panel.eventMode = 'none';
  panel.zIndex = 10_000;

  const height = lines.length * LINE_HEIGHT + PADDING * 2;
  const background = new Graphics();
  background
    .rect(0, 0, PANEL_WIDTH, height)
    .fill({ color: 0x090d16, alpha: 0.92 })
    .stroke({ color: 0x7dd3fc, alpha: 0.55, width: 1 });
  panel.addChild(background);

  for (const [index, line] of lines.entries()) {
    const text = new Text({
      text: line,
      style: {
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: LINE_HEIGHT,
        fill: index === 0 ? 0xe0f2fe : 0xcbd5e1,
      },
    });
    text.label = 'content-identity-label';
    text.x = PADDING;
    text.y = PADDING + index * LINE_HEIGHT;
    text.eventMode = 'none';
    panel.addChild(text);
  }

  options.container.addChild(panel);
};

/** Keeps one screen-fixed overlay container on the Pixi stage for the engine owner. */
export const syncContentIdentityOverlay = (options: { stage: Container }): void => {
  const existing = options.stage.getChildByLabel('content-identity-overlay');
  const container = existing instanceof Container ? existing : new Container();
  if (container !== existing) {
    container.label = 'content-identity-overlay';
    container.eventMode = 'none';
    options.stage.addChild(container);
  }
  drawContentIdentityOverlay({ container });
};
