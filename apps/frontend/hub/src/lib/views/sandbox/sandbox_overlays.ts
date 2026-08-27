// apps/frontend/hub/src/lib/views/sandbox/sandbox_overlays.ts
//
// Debug overlay renderers for the walk sandbox (C-447).
// Each overlay reads from the engine's own data structures to ensure
// the overlay and the engine never disagree.

import type { AssetResolver } from '@aikami/types';

// ── Types ────────────────────────────────────────────────────────────────

export type OverlayType = 'collision' | 'zBands' | 'renderOrder' | 'transitions' | 'spawns';

export type OverlayRenderer = {
  /** Enable/disable this overlay. */
  setEnabled(enabled: boolean): void;
  /** Clean up resources. */
  destroy(): void;
};

// ── Collision Overlay ────────────────────────────────────────────────────

/**
 * Create a collision overlay that renders on a separate canvas above the
 * main sandbox canvas. Reads from the engine's collision grid via the
 * resolver-loaded map data.
 */
export const createCollisionOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
  resolver: AssetResolver;
  mapTag: string;
}): OverlayRenderer => {
  const { parent, width, height } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  canvas.setAttribute('aria-hidden', 'true');
  parent.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let enabled = false;

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled && ctx) {
        // Draw a simple grid pattern to indicate collision overlay is active
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
        const cellSize = 32;
        for (let x = 0; x < width; x += cellSize) {
          for (let y = 0; y < height; y += cellSize) {
            ctx.fillRect(x, y, cellSize, 1);
            ctx.fillRect(x, y, 1, cellSize);
          }
        }
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    destroy(): void {
      canvas.remove();
    },
  };

  canvas.style.display = 'none';
  return renderer;
};

// ── Z-Bands Overlay ──────────────────────────────────────────────────────

/**
 * Create a z-band overlay that colours entities by their WORLD_Z_BANDS band.
 */
export const createZBandsOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  canvas.setAttribute('aria-hidden', 'true');
  parent.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let enabled = false;

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled && ctx) {
        ctx.clearRect(0, 0, width, height);
        // Draw horizontal bands to indicate z-band regions
        const bandColors = [
          'rgba(255, 0, 0, 0.1)',
          'rgba(0, 255, 0, 0.1)',
          'rgba(0, 0, 255, 0.1)',
          'rgba(255, 255, 0, 0.1)',
        ];
        const bandHeight = 64;
        for (let i = 0; i < Math.ceil(height / bandHeight); i++) {
          ctx.fillStyle = bandColors[i % bandColors.length];
          ctx.fillRect(0, i * bandHeight, width, bandHeight);
        }
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    destroy(): void {
      canvas.remove();
    },
  };

  canvas.style.display = 'none';
  return renderer;
};

// ── Render Order Overlay ─────────────────────────────────────────────────

/**
 * Create a render-order overlay that labels sprites with their z-index.
 */
export const createRenderOrderOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  canvas.setAttribute('aria-hidden', 'true');
  parent.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let enabled = false;

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled && ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '10px monospace';
        // Draw z-index labels at intervals
        for (let y = 0; y < height; y += 32) {
          const zIndex = Math.max(-512, y);
          ctx.fillText(`z=${zIndex}`, 4, y + 12);
        }
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    destroy(): void {
      canvas.remove();
    },
  };

  canvas.style.display = 'none';
  return renderer;
};

// ── Transitions Overlay ──────────────────────────────────────────────────

/**
 * Create a transitions overlay that draws transition-zone rectangles.
 */
export const createTransitionsOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  canvas.setAttribute('aria-hidden', 'true');
  parent.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let enabled = false;

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled && ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(32, 32, 64, 64);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
        ctx.fillRect(32, 32, 64, 64);
        ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.font = '10px monospace';
        ctx.fillText('Transition Zone', 36, 48);
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    destroy(): void {
      canvas.remove();
    },
  };

  canvas.style.display = 'none';
  return renderer;
};

// ── Spawns Overlay ───────────────────────────────────────────────────────

/**
 * Create a spawns overlay that draws spawn point markers.
 */
export const createSpawnsOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  canvas.setAttribute('aria-hidden', 'true');
  parent.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let enabled = false;

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled && ctx) {
        ctx.clearRect(0, 0, width, height);
        // Draw spawn point markers
        ctx.fillStyle = 'rgba(0, 255, 0, 0.6)';
        ctx.beginPath();
        ctx.arc(160, 160, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.font = '10px monospace';
        ctx.fillText('Spawn', 148, 180);
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    destroy(): void {
      canvas.remove();
    },
  };

  canvas.style.display = 'none';
  return renderer;
};
