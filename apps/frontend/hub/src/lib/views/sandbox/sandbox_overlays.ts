// apps/frontend/hub/src/lib/views/sandbox/sandbox_overlays.ts
//
// Debug overlay renderers for the walk sandbox (C-447).
// Each overlay reads from the engine's own data structures to ensure
// the overlay and the engine never disagree.

import type { CollisionGrid, SpawnPoint, TransitionZone } from '@aikami/frontend/engine';
import { computeEntityZIndex, WORLD_Z_BANDS } from '@aikami/frontend/engine';

// ── Types ────────────────────────────────────────────────────────────────

export type OverlayType = 'collision' | 'zBands' | 'renderOrder' | 'transitions' | 'spawns';

export type OverlayData = {
  /** Collision grid extracted from the map. */
  collisionGrid?: CollisionGrid;
  /** Transition zones extracted from the map. */
  transitionZones?: readonly TransitionZone[];
  /** Spawn points extracted from the map. */
  spawnPoints?: readonly SpawnPoint[];
};

export type OverlayRenderer = {
  /** Enable/disable this overlay. */
  setEnabled(enabled: boolean): void;
  /** Update the overlay data (e.g. when map changes). */
  updateData(data: OverlayData): void;
  /** Clean up resources. */
  destroy(): void;
};

// ── Canvas helper ─────────────────────────────────────────────────────────

const createOverlayCanvas = (
  parent: HTMLElement,
  width: number,
  height: number,
): HTMLCanvasElement => {
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
  return canvas;
};

const TILE_SIZE = 32;

// ── Collision Overlay ────────────────────────────────────────────────────

/**
 * Create a collision overlay that tints cells the engine's collision
 * system reports as blocked. Reads from the engine's own collision grid
 * data — never computes its own walkability.
 */
export const createCollisionOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;
  const canvas = createOverlayCanvas(parent, width, height);
  const ctx = canvas.getContext('2d');
  let enabled = false;
  let collisionGrid: CollisionGrid | undefined;

  const draw = (): void => {
    if (!ctx || !collisionGrid) {
      return;
    }
    ctx.clearRect(0, 0, width, height);

    const { grid, width: mapWidth, height: mapHeight } = collisionGrid;
    const tilesX = mapWidth;
    const tilesY = mapHeight;

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const cell = grid[ty * tilesX + tx];
        // A blocked cell is explicitly marked as true in the collision grid
        if (cell === true) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          // Draw a subtle border around blocked cells
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  };

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        draw();
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    updateData(data: OverlayData): void {
      collisionGrid = data.collisionGrid;
      if (enabled) {
        draw();
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
 * Uses the engine's own WORLD_Z_BANDS constant — never recomputes bands.
 */
export const createZBandsOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;
  const canvas = createOverlayCanvas(parent, width, height);
  const ctx = canvas.getContext('2d');
  let enabled = false;

  // Build band definitions from the engine's WORLD_Z_BANDS
  const bandEntries = Object.entries(WORLD_Z_BANDS) as [string, number][];
  // Sort by z-index ascending
  bandEntries.sort(([, a], [, b]) => a - b);

  const bandColors = [
    'rgba(255, 0, 0, 0.12)',
    'rgba(0, 255, 0, 0.12)',
    'rgba(0, 0, 255, 0.12)',
    'rgba(255, 255, 0, 0.12)',
    'rgba(255, 0, 255, 0.12)',
    'rgba(0, 255, 255, 0.12)',
  ];

  const draw = (): void => {
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, width, height);

    // Draw horizontal bands corresponding to WORLD_Z_BANDS thresholds
    // Each band spans from its z-index to the next band's z-index
    for (let i = 0; i < bandEntries.length; i++) {
      const [, zIndex] = bandEntries[i];
      // Convert z-index to Y position (z-index = y in the engine)
      const bandY = Math.max(0, zIndex);
      const nextZ = i < bandEntries.length - 1 ? bandEntries[i + 1][1] : height;
      const bandHeight = Math.min(nextZ - bandY, height - bandY);

      if (bandHeight <= 0) {
        continue;
      }

      ctx.fillStyle = bandColors[i % bandColors.length];
      ctx.fillRect(0, bandY, width, bandHeight);

      // Label the band
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '9px monospace';
      ctx.fillText(`${bandEntries[i][0]} (z=${zIndex})`, 4, bandY + 10);
    }
  };

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        draw();
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    updateData(_data: OverlayData): void {
      // Z-bands are derived from WORLD_Z_BANDS constant — no data dependency
      if (enabled) {
        draw();
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
 * Create a render-order overlay that labels each sprite with its
 * computeEntityZIndex value. Uses the engine's own computeEntityZIndex
 * function — never recomputes z-indices.
 */
export const createRenderOrderOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;
  const canvas = createOverlayCanvas(parent, width, height);
  const ctx = canvas.getContext('2d');
  let enabled = false;

  const draw = (): void => {
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, width, height);

    // Draw z-index labels at each tile row using the engine's computeEntityZIndex
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '9px monospace';
    for (let y = 0; y < height; y += TILE_SIZE) {
      const zIndex = computeEntityZIndex(y);
      ctx.fillText(`z=${zIndex}`, 4, y + 10);
    }
  };

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        draw();
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    updateData(_data: OverlayData): void {
      // Render-order labels use computeEntityZIndex — no data dependency
      if (enabled) {
        draw();
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
 * Create a transitions overlay that draws transition-zone rectangles
 * from the engine's extractTransitionZones data.
 */
export const createTransitionsOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;
  const canvas = createOverlayCanvas(parent, width, height);
  const ctx = canvas.getContext('2d');
  let enabled = false;
  let transitionZones: readonly TransitionZone[] | undefined;

  const draw = (): void => {
    if (!ctx || !transitionZones || transitionZones.length === 0) {
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        // Show "no zones" message when enabled but no data
        if (enabled) {
          ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
          ctx.font = '10px monospace';
          ctx.fillText('No transition zones on this map', 8, 20);
        }
      }
      return;
    }
    ctx.clearRect(0, 0, width, height);

    for (const zone of transitionZones) {
      const x = zone.x * TILE_SIZE;
      const y = zone.y * TILE_SIZE;
      const w = zone.width * TILE_SIZE;
      const h = zone.height * TILE_SIZE;

      ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
      ctx.font = '9px monospace';
      const label = zone.targetMap ? `→ ${zone.targetMap.slice(0, 30)}` : 'Transition Zone';
      ctx.fillText(label, x + 4, y + 12);
    }
  };

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        draw();
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    updateData(data: OverlayData): void {
      transitionZones = data.transitionZones;
      if (enabled) {
        draw();
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
 * Create a spawns overlay that draws spawn point markers from the
 * engine's extractSpawnPoints data.
 */
export const createSpawnsOverlay = (options: {
  parent: HTMLElement;
  width: number;
  height: number;
}): OverlayRenderer => {
  const { parent, width, height } = options;
  const canvas = createOverlayCanvas(parent, width, height);
  const ctx = canvas.getContext('2d');
  let enabled = false;
  let spawnPoints: readonly SpawnPoint[] | undefined;

  const draw = (): void => {
    if (!ctx || !spawnPoints || spawnPoints.length === 0) {
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        if (enabled) {
          ctx.fillStyle = 'rgba(0, 255, 0, 0.4)';
          ctx.font = '10px monospace';
          ctx.fillText('No spawn points on this map', 8, 20);
        }
      }
      return;
    }
    ctx.clearRect(0, 0, width, height);

    for (const spawn of spawnPoints) {
      const sx = spawn.x * TILE_SIZE + TILE_SIZE / 2;
      const sy = spawn.y * TILE_SIZE + TILE_SIZE / 2;

      // Draw a cross marker
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy);
      ctx.lineTo(sx + 8, sy);
      ctx.moveTo(sx, sy - 8);
      ctx.lineTo(sx, sy + 8);
      ctx.stroke();

      // Draw a circle
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)';
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.font = '9px monospace';
      const label = spawn.name ?? `Spawn (${spawn.x}, ${spawn.y})`;
      ctx.fillText(label, sx + 12, sy + 4);
    }
  };

  const renderer: OverlayRenderer = {
    setEnabled(en: boolean): void {
      enabled = en;
      canvas.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        draw();
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },
    updateData(data: OverlayData): void {
      spawnPoints = data.spawnPoints;
      if (enabled) {
        draw();
      }
    },
    destroy(): void {
      canvas.remove();
    },
  };

  canvas.style.display = 'none';
  return renderer;
};
