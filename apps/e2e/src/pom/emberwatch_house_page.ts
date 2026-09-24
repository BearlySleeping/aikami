// apps/e2e/src/pom/emberwatch_house_page.ts
//
// Page Object Model for the C-550 Emberwatch house evidence lane. It keeps
// production-route navigation, map loading, renderer checks, and position
// probes behind one small object so the capture script never reaches into
// page globals or DOM selectors directly.

import type { Page } from '@playwright/test';
import { EMULATOR_PORTS } from '../config';
import {
  assertEntityTexturesResolved,
  type EntityTextureObservation,
} from '../visual/core/entity_texture_guard.ts';
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
      textScale?: number;
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
    if (options.textScale !== undefined) {
      await this.page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, options.textScale);
    }
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

  /**
   * Wait until every visible scene-graph entity has a resolved texture.
   *
   * Actor composition is asynchronous after a map load. The generated-artifact
   * fingerprint cannot observe that runtime state, so capture fails closed when
   * a primitive placeholder or 1×1 texture is still visible.
   */
  async requireResolvedEntityTextures(): Promise<readonly EntityTextureObservation[]> {
    const deadline = Date.now() + 5_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      const probe = await this.page.evaluate(() => {
        type Dict = Record<string, unknown>;
        type Bounds = { x: number; y: number; width: number; height: number };
        type TextureCounts = { resolved: number; unresolved: number };
        type Observation = {
          entityId: string;
          visible: boolean;
          displayType: 'sprite' | 'composed' | 'graphics' | 'missing';
          resolvedTextureCount: number;
          unresolvedTextureCount: number;
        };
        const isRecord = (value: unknown): value is Dict => value instanceof Object;
        const childrenOf = (value: unknown): unknown[] =>
          isRecord(value) && Array.isArray(value.children) ? (value.children as unknown[]) : [];
        const labelOf = (value: unknown): string =>
          isRecord(value) && typeof value.label === 'string' ? value.label : '';
        const numberOf = (value: Dict, key: string): number | undefined => {
          const candidate = value[key];
          return typeof candidate === 'number' && Number.isFinite(candidate)
            ? candidate
            : undefined;
        };
        const globals = window as unknown as Dict;
        const getDebug = (): Dict | undefined => {
          const value = globals.__AIKAMI_DEBUG__;
          return isRecord(value) ? value : undefined;
        };
        const getStage = (): Dict | undefined => {
          const app = globals.__PIXI_APP__;
          if (!isRecord(app) || !isRecord(app.stage)) {
            return undefined;
          }
          return app.stage;
        };
        const getWorld = (): Dict | undefined => {
          const stage = getStage();
          const world = childrenOf(stage).find((child) =>
            childrenOf(child).some((nested) => labelOf(nested).startsWith('tilemap-band-')),
          );
          return isRecord(world) ? world : undefined;
        };
        const readPosition = (value: unknown): { x: number; y: number } | undefined => {
          if (!isRecord(value)) {
            return undefined;
          }
          const x = numberOf(value, 'x');
          const y = numberOf(value, 'y');
          return x === undefined || y === undefined ? undefined : { x, y };
        };
        const getPositions = (): Map<string, { x: number; y: number }> => {
          const positions = new Map<string, { x: number; y: number }>();
          const value = getDebug()?.entityPositions;
          if (!isRecord(value)) {
            return positions;
          }
          for (const [entityId, entry] of Object.entries(value)) {
            const position = readPosition(entry);
            if (position !== undefined) {
              positions.set(entityId, position);
            }
          }
          return positions;
        };
        const getBounds = (value: Dict): Bounds | undefined => {
          const getter = value.getBounds;
          if (typeof getter !== 'function') {
            return undefined;
          }
          const result = getter.call(value);
          if (!isRecord(result)) {
            return undefined;
          }
          const x = numberOf(result, 'x');
          const y = numberOf(result, 'y');
          const width = numberOf(result, 'width');
          const height = numberOf(result, 'height');
          if (x === undefined || y === undefined || width === undefined || height === undefined) {
            return undefined;
          }
          return { x, y, width, height };
        };
        const stageBounds = getBounds(getStage() ?? {});
        const isVisible = (bounds: Bounds | undefined, visible: boolean): boolean => {
          if (!visible) {
            return false;
          }
          if (!stageBounds || !bounds) {
            return true;
          }
          return (
            bounds.x + bounds.width >= stageBounds.x &&
            bounds.x <= stageBounds.x + stageBounds.width &&
            bounds.y + bounds.height >= stageBounds.y &&
            bounds.y <= stageBounds.y + stageBounds.height
          );
        };
        const countTexture = (texture: Dict, counts: TextureCounts): void => {
          const width = numberOf(texture, 'width');
          const height = numberOf(texture, 'height');
          if (width === undefined || height === undefined) {
            return;
          }
          if (width > 1 && height > 1 && texture.valid !== false) {
            counts.resolved += 1;
            return;
          }
          counts.unresolved += 1;
        };
        const addTextureCount = (value: unknown, counts: TextureCounts): void => {
          if (!isRecord(value)) {
            return;
          }
          const texture = value.texture;
          if (isRecord(texture)) {
            countTexture(texture, counts);
          }
        };
        const readTextureCounts = (node: unknown): TextureCounts => {
          const counts: TextureCounts = { resolved: 0, unresolved: 0 };
          addTextureCount(node, counts);
          for (const child of childrenOf(node)) {
            addTextureCount(child, counts);
          }
          return counts;
        };
        const readDisplayType = (node: Dict, counts: TextureCounts): Observation['displayType'] => {
          if (counts.resolved + counts.unresolved === 0) {
            return node.constructor?.name === 'Graphics' ? 'graphics' : 'missing';
          }
          return childrenOf(node).length > 0 ? 'composed' : 'sprite';
        };
        const ignoredLabels = [
          'tilemap-band-',
          'zone-overlay-',
          'debug-grid',
          'authoring-overlay',
          'hover-highlight',
          'destination-marker',
          'combat-',
          'weather-',
        ];
        const findEntityId = (
          node: Dict,
          index: number,
          positionMap: ReadonlyMap<string, { x: number; y: number }>,
        ): string => {
          const x = numberOf(node, 'x');
          const y = numberOf(node, 'y');
          if (x === undefined || y === undefined) {
            return `unidentified:${index}`;
          }
          for (const [entityId, position] of positionMap) {
            if (Math.abs(position.x - x) <= 4 && Math.abs(position.y - y) <= 4) {
              return entityId;
            }
          }
          return `unidentified:${index}`;
        };
        const toObservation = (
          node: unknown,
          index: number,
          positionMap: ReadonlyMap<string, { x: number; y: number }>,
        ): Observation | undefined => {
          if (!isRecord(node) || ignoredLabels.some((prefix) => labelOf(node).startsWith(prefix))) {
            return undefined;
          }
          if (numberOf(node, 'x') === undefined || numberOf(node, 'y') === undefined) {
            return undefined;
          }
          const counts = readTextureCounts(node);
          return {
            entityId: findEntityId(node, index, positionMap),
            visible: isVisible(getBounds(node), node.visible !== false),
            displayType: readDisplayType(node, counts),
            resolvedTextureCount: counts.resolved,
            unresolvedTextureCount: counts.unresolved,
          };
        };
        const entityPositions = getPositions();
        const worldChildren = childrenOf(getWorld());
        const observations = worldChildren.flatMap((node, index) => {
          const observation = toObservation(node, index, entityPositions);
          return observation === undefined ? [] : [observation];
        });
        const playerEid = getDebug()?.playerEid;
        return {
          observations,
          playerEid: typeof playerEid === 'number' ? String(playerEid) : undefined,
        };
      });
      try {
        assertEntityTexturesResolved(probe.observations);
        if (probe.playerEid === undefined) {
          throw new Error('C-550 entity texture guard could not identify the player entity');
        }
        if (!probe.observations.some((observation) => observation.entityId === probe.playerEid)) {
          throw new Error(
            `C-550 entity texture guard found no visible display for player ${probe.playerEid}`,
          );
        }
        return probe.observations;
      } catch (error: unknown) {
        lastError = error;
        await this.page.waitForTimeout(100);
      }
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('C-550 entity texture guard timed out before textures resolved');
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
      typeof raw.engine?.cameraX === 'number' &&
      Number.isFinite(raw.engine.cameraX) &&
      typeof raw.engine.cameraY === 'number' &&
      Number.isFinite(raw.engine.cameraY);
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
    await this.requireResolvedEntityTextures();
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
