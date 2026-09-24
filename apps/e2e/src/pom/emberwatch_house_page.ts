// apps/e2e/src/pom/emberwatch_house_page.ts
//
// Page Object Model for the C-550 Emberwatch house evidence lane. It keeps
// production-route navigation, map loading, renderer checks, and position
// probes behind one small object so the capture script never reaches into
// page globals or DOM selectors directly.

import type { Page } from '@playwright/test';
import { EMULATOR_PORTS } from '../config';
import { assertGpuRendererName } from '../visual/core/gpu_renderer_guard.ts';
import { GamePage } from './game_page';

export type EmberwatchHouseCell = { c: number; r: number };

export type EmberwatchHouseWorldSnapshot = {
  player: EmberwatchHouseCell & { x: number; y: number };
  camera: EmberwatchHouseCell & { x: number; y: number };
  cameraSource: 'engine' | 'playerFallback';
  renderer: string;
  mapId: string;
};

type EngineState = {
  frozen?: boolean;
  cameraX?: number;
  cameraY?: number;
};

type PlayerDebug = {
  playerX?: number;
  playerY?: number;
};

const HOUSE_CELL_SIZE = 32;

/** Resolve a cell center in the same world-pixel coordinates used by `loadMap`. */
const cellCenter = (cell: EmberwatchHouseCell): { x: number; y: number } => ({
  x: cell.c * HOUSE_CELL_SIZE + HOUSE_CELL_SIZE / 2,
  y: cell.r * HOUSE_CELL_SIZE + HOUSE_CELL_SIZE / 2,
});

const toCell = (x: number, y: number): EmberwatchHouseCell & { x: number; y: number } => ({
  c: Math.floor(x / HOUSE_CELL_SIZE),
  r: Math.floor(y / HOUSE_CELL_SIZE),
  x,
  y,
});

/** Production `/game` page operations required by the house capture lane. */
export class EmberwatchHousePage {
  readonly page: Page;
  readonly game: GamePage;
  readonly origin: string;

  constructor(page: Page) {
    this.page = page;
    this.game = new GamePage(page);
    this.origin = process.env.C550_CLIENT_URL ?? `http://localhost:${EMULATOR_PORTS.client}`;
  }

  /** Navigate to the real game route with deterministic visual parameters. */
  async goto(
    options: {
      gameHour?: number;
      e2e?: boolean;
      authoring?: boolean;
      authoringLayers?: readonly string[];
    } = {},
  ): Promise<void> {
    const params = new URLSearchParams({
      screenshot: 'true',
      gameHour: String(options.gameHour ?? 12),
    });
    if (options.e2e) {
      params.set('e2e', 'true');
    }
    if (options.authoring) {
      params.set('authoring', 'true');
      if (options.authoringLayers && options.authoringLayers.length > 0) {
        params.set('authoringLayers', options.authoringLayers.join(','));
      }
    }
    await this.page.goto(`${this.origin}/game?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await this.game.waitForEngineReady();
    await this.waitForSeam();
    await this.dismissTutorial();
    await this.waitForEngineState();
    await this.dismissTutorial();
  }

  /** Load an authored map through the existing production map-loading seam. */
  async loadMapAt(mapId: 'village' | 'inn', cell: EmberwatchHouseCell): Promise<void> {
    const center = cellCenter(cell);
    const loaded = await this.page.evaluate(
      async (options) => {
        const seam = (
          window as unknown as {
            __AIKAMI_TEST__?: {
              loadPackMap(options: {
                mapId: string;
                nearX?: number;
                nearY?: number;
              }): Promise<boolean>;
            };
          }
        ).__AIKAMI_TEST__;
        if (!seam) {
          return false;
        }
        return seam.loadPackMap(options);
      },
      { mapId, nearX: center.x, nearY: center.y },
    );
    if (!loaded) {
      throw new Error(`C-550 evidence: production seam failed to load ${mapId}`);
    }
    await this.page.waitForFunction(
      (expectedMapId) => {
        const seam = (window as unknown as { __AIKAMI_TEST__?: { getCurrentMapId(): string } })
          .__AIKAMI_TEST__;
        return seam?.getCurrentMapId() === expectedMapId;
      },
      mapId,
      { timeout: 20_000 },
    );
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await this.waitForEngineState();
    await this.dismissTutorial();
  }

  /** Load the village through the production map-loading seam. */
  async loadVillageAt(cell: EmberwatchHouseCell): Promise<void> {
    await this.loadMapAt('village', cell);
  }

  /** Dismiss the first-run movement toast when present; no-op on later runs. */
  async dismissTutorial(): Promise<boolean> {
    const skip = this.page.getByRole('button', { name: /skip/i }).first();
    const visible = await skip.isVisible().catch(() => false);
    if (visible) {
      await skip.click();
      await this.page.waitForTimeout(100);
    }
    return visible;
  }

  /** Read the live Pixi renderer and fail closed unless it is WebGL. */
  async requireWebGL(): Promise<string> {
    const renderer = await this.page.evaluate(() => {
      const record = window as unknown as Record<string, unknown>;
      const app = record.__PIXI_APP__ as { renderer?: { name?: string } } | undefined;
      return app?.renderer?.name ?? undefined;
    });
    assertGpuRendererName(renderer ?? null, 'pixi');
    if (renderer !== 'webgl') {
      throw new Error(`C-550 evidence requires WebGL, got ${renderer ?? 'missing renderer'}`);
    }
    return renderer;
  }

  /** Read player, camera, map, and renderer state from the live production route. */
  async snapshot(): Promise<EmberwatchHouseWorldSnapshot> {
    const raw = await this.page.evaluate(() => {
      const record = window as unknown as Record<string, unknown>;
      return {
        player: record.__AIKAMI_DEBUG__ as PlayerDebug | undefined,
        engine: record.__AIKAMI_ENGINE_STATE__ as EngineState | undefined,
      };
    });
    if (raw.player?.playerX === undefined || raw.player.playerY === undefined) {
      throw new Error('C-550 evidence: engine position diagnostics are unavailable');
    }
    const hasEngineCamera =
      raw.engine?.cameraX !== undefined &&
      raw.engine.cameraX > 0 &&
      raw.engine.cameraY !== undefined &&
      raw.engine.cameraY > 0;
    const cameraX = hasEngineCamera
      ? (raw.engine?.cameraX ?? raw.player.playerX)
      : raw.player.playerX;
    const cameraY = hasEngineCamera
      ? (raw.engine?.cameraY ?? raw.player.playerY)
      : raw.player.playerY;
    const renderer = await this.requireWebGL();
    return {
      player: toCell(raw.player.playerX, raw.player.playerY),
      camera: toCell(cameraX, cameraY),
      cameraSource: hasEngineCamera ? 'engine' : 'playerFallback',
      renderer,
      mapId: await this.currentMapId(),
    };
  }

  /** Current map id reported by the production loader. */
  async currentMapId(): Promise<string> {
    return this.page.evaluate(() => {
      const seam = (
        window as unknown as {
          __AIKAMI_TEST__?: { getCurrentMapId(): string };
        }
      ).__AIKAMI_TEST__;
      if (!seam) {
        throw new Error('C-550 evidence: test seam is unavailable');
      }
      return seam.getCurrentMapId();
    });
  }

  /** Hold a movement key for a bounded interval and let the engine settle. */
  async move(key: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD', holdMs = 450): Promise<void> {
    await this.page.keyboard.down(key);
    await this.page.waitForTimeout(holdMs);
    await this.page.keyboard.up(key);
    await this.page.waitForTimeout(150);
  }

  /** Capture only after re-asserting the live renderer. */
  async capture(path: string): Promise<EmberwatchHouseWorldSnapshot> {
    await this.dismissTutorial();
    await this.requireWebGL();
    const snapshot = await this.snapshot();
    await this.page.screenshot({ path, animations: 'disabled' });
    return snapshot;
  }

  private async waitForSeam(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const record = window as unknown as Record<string, unknown>;
        const seam = record.__AIKAMI_TEST__ as { loadPackMap?: unknown } | undefined;
        return typeof seam?.loadPackMap === 'function';
      },
      undefined,
      { timeout: 20_000 },
    );
  }

  private async waitForEngineState(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const record = window as unknown as Record<string, unknown>;
        const player = record.__AIKAMI_DEBUG__ as PlayerDebug | undefined;
        return player?.playerX !== undefined && player.playerY !== undefined;
      },
      undefined,
      { timeout: 20_000 },
    );
  }
}
