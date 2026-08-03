// apps/frontend/client/src/lib/views/dev/lpc_walk/lpc_walk_test_view_model.svelte.ts
//
// LPC Walk Animation Tester ViewModel — isolated WASD-driven walk animation
// debugger using PixiJS directly with the engine AnimationController.
// No ECS/bitECS dependency — pure animation controller + PixiJS rendering.

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine';
import { AnimationController, LpcDirection } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { Application, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { wireLpcUrlResolver } from '$lib/data/lpc_asset_catalog';
import { LpcAnimationState } from '$lib/data/lpc_models';
import { loadLpcSheet } from '$lib/data/lpc_renderer';

// ── Constants ────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 512;
const BG_COLOR = 0x0d0d1a;
const FRAME_W = 64;
const FRAME_H = 64;
const WALK_SPEED = 200;
const FRAMES_PER_WALK = 9;

const DIRECTION_LABELS: Record<number, string> = {
  [LpcDirection.Up]: 'Up',
  [LpcDirection.Left]: 'Left',
  [LpcDirection.Down]: 'Down',
  [LpcDirection.Right]: 'Right',
};

const SLOT_Z_ORDER: Record<string, number> = {
  body: 0,
  legs: 10,
  feet: 20,
  torso: 30,
  head: 40,
  hair: 50,
};
const DEFAULT_Z = 100;

// ── Types ────────────────────────────────────────────────────────────────

export type LpcWalkTestViewModelInterface = BaseViewModelInterface & {
  canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;

  readonly animFrame: number;
  readonly directionLabel: string;
  readonly isIdle: boolean;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly fps: number;
  readonly effectiveTicks: number;
  readonly isReady: boolean;
  readonly loadedLayers: number;
  readonly totalLayers: number;
  readonly tickCount: number;
  readonly missingAssets: string[];
  readonly stuckFrameTicks: number;

  loadRecipe(recipe: Record<string, string>): void;
  resetRecipe(): void;
};

export type LpcWalkTestViewModelOptions = BaseViewModelOptions & {};

// ── Implementation ───────────────────────────────────────────────────────

class LpcWalkTestViewModel
  extends BaseViewModel<LpcWalkTestViewModelOptions>
  implements LpcWalkTestViewModelInterface
{
  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  animFrame = $state(0);
  directionLabel = $state('Down');
  isIdle = $state(true);
  velocityX = $state(0);
  velocityY = $state(0);
  fps = $state(0);
  effectiveTicks = $state(0);
  isReady = $state(false);
  loadedLayers = $state(0);
  totalLayers = $state(0);
  tickCount = $state(0);
  missingAssets = $state<string[]>([]);

  activeRecipe = $state<Record<string, string>>({ ...DEFAULT_LPC_RECIPE });

  private _pixiApp: Application | undefined;
  private _characterContainer: Container | undefined;
  private _currentSprites: Sprite[] = [];
  private _posX = 0;
  private _posY = 0;
  private _animController = new AnimationController();
  private _keysDown: Record<string, boolean> = { w: false, a: false, s: false, d: false };
  private _sheetCache = new Map<string, Texture>();
  private _spriteSheets = new Map<Sprite, Texture>();
  private _onKeyDownBound = this._onKeyDown.bind(this);
  private _onKeyUpBound = this._onKeyUp.bind(this);
  private _currentDirection: LpcDirection = LpcDirection.Down;
  private _tickLocal = 0;
  /** Generation counter to guard against stale async loads during HMR. */
  private _gen = 0;
  /** Ticks the animation has been stuck on frame 0 while not idle. */
  stuckFrameTicks = $state(0);

  // ── Public ─────────────────────────────────────────────────────────

  setCanvasElement(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
  }

  loadRecipe(recipe: Record<string, string>): void {
    this.activeRecipe = { ...recipe };
    this._sheetCache.clear();
    void this._reloadTextures();
  }

  resetRecipe(): void {
    this.activeRecipe = { ...DEFAULT_LPC_RECIPE };
    this._sheetCache.clear();
    void this._reloadTextures();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Ensure the manifest-backed LPC URL resolver is wired and the manifest
    // is loaded before any layer lookup (idempotent).
    await wireLpcUrlResolver();

    this.registerEffectRoot(() => {
      $effect(() => {
        if (this.canvasElement && !this._pixiApp) {
          void this._initPixiApp();
        }
      });
    });

    await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.debug('lpcWalk.dispose');
    this._removeKeyboardListeners();
    this._destroyAllSprites();
    this._sheetCache.clear();

    if (this._pixiApp) {
      this._pixiApp.destroy(true, { children: true });
      this._pixiApp = undefined;
    }

    await super.dispose();
  }

  // ── Private: PixiJS init ──────────────────────────────────────────

  private async _initPixiApp(): Promise<void> {
    if (!this.canvasElement) {
      return;
    }

    this._gen++;
    const gen = this._gen;

    this.debug('lpcWalk.init.start');

    try {
      this._pixiApp = new Application();
      await this._pixiApp.init({
        canvas: this.canvasElement,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        background: BG_COLOR,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        sharedTicker: false,
      });

      if (gen !== this._gen) {
        this.debug('lpcWalk.init.stale');
        return;
      }

      this.debug('lpcWalk.init.pixi-ready', {
        renderer: this._pixiApp.renderer.type,
        fps: this._pixiApp.ticker.FPS,
      });

      // Log resolved-layer count for debugging
      this.debug('lpcWalk.init.ready', { loadedLayers: 0 });

      this._addKeyboardListeners();
      this.debug('lpcWalk.init.listeners-added');

      // Main game loop
      this._pixiApp.ticker.add(() => {
        this._tickLocal++;
        const delta = this._pixiApp?.ticker.deltaMS ?? 16.6;

        const rawVx = (this._keysDown.d ? 1 : 0) - (this._keysDown.a ? 1 : 0);
        const rawVy = (this._keysDown.s ? 1 : 0) - (this._keysDown.w ? 1 : 0);
        const vx = rawVx * WALK_SPEED;
        const vy = rawVy * WALK_SPEED;

        this._posX += vx * (delta / 1000);
        this._posY += vy * (delta / 1000);

        this._animController.update({ x: this._posX, y: this._posY });
        const direction = this._animController.direction;
        const newFrame = this._animController.getFrameColumn(FRAMES_PER_WALK);

        const frameChanged = this.animFrame !== newFrame || this._currentDirection !== direction;

        if (rawVx !== 0 || rawVy !== 0) {
          // Log every 30 ticks while moving to avoid spam
          if (this._tickLocal % 30 === 0) {
            this.debug('lpcWalk.tick.moving', {
              tick: this._tickLocal,
              rawVx,
              rawVy,
              frame: newFrame,
              dir: direction,
              changed: frameChanged,
              sprites: this._currentSprites.length,
            });
          }
        }

        this.animFrame = newFrame;
        this._currentDirection = direction;
        this.directionLabel = DIRECTION_LABELS[direction] ?? 'Down';
        this.isIdle = this._animController.isIdle;
        this.velocityX = rawVx;
        this.velocityY = rawVy;
        this.effectiveTicks = this._animController.effectiveTickCount;
        this.fps = this._pixiApp?.ticker.FPS ?? 0;
        this.tickCount = this._tickLocal;

        // Track sustained stall on frame 0 — true stuck after ~0.5s (30 ticks)
        if (!this.isIdle && this.animFrame === 0) {
          this.stuckFrameTicks++;
        } else {
          this.stuckFrameTicks = 0;
        }

        if (frameChanged) {
          this._updateFramePositions();
        }
      });

      this.isReady = true;
      this.debug('lpcWalk.init.ready');

      await this._reloadTextures();
      this.debug('lpcWalk.init.textures-loaded', {
        sprites: this._currentSprites.length,
        missing: this.missingAssets,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcWalk.initFailed', { error: message });
    }
  }

  // ── Private: texture loading + sprite composition ────────────────

  private async _reloadTextures(): Promise<void> {
    if (!this._pixiApp) {
      return;
    }

    this._destroyAllSprites();
    const missing: string[] = [];

    const recipes: LpcLayerRecipe[] = Object.entries(this.activeRecipe).map(([slot, assetId]) => ({
      slot,
      assetId,
      hexPalette: new Uint8Array(1024),
    }));

    this.totalLayers = recipes.length;
    this.debug('lpcWalk.reload.start', { layers: recipes.length, recipe: this.activeRecipe });

    try {
      const sprites: Array<{ sprite: Sprite; zIndex: number }> = [];
      let loaded = 0;

      for (const recipe of recipes) {
        const texture = await this._loadWalkSheet(recipe.assetId);
        if (!texture) {
          missing.push(`${recipe.slot}=${recipe.assetId}`);
          this.debug('lpcWalk.reload.missing', { slot: recipe.slot, assetId: recipe.assetId });
          continue;
        }

        const columns = Math.max(1, Math.floor(texture.width / FRAME_W));
        const rows = Math.max(1, Math.floor(texture.height / FRAME_H));
        const col = this.animFrame % columns;
        const row = this._currentDirection;
        const x = col * FRAME_W;
        const y = row * FRAME_H;

        if (x + FRAME_W > texture.width || y + FRAME_H > texture.height) {
          this.warn('lpcWalk.reload.bounds', {
            slot: recipe.slot,
            texW: texture.width,
            texH: texture.height,
            col,
            row,
            columns,
            rows,
          });
          continue;
        }

        const frameTexture = new Texture({
          source: texture.source,
          frame: new Rectangle(x, y, FRAME_W, FRAME_H),
        });

        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        sprite.x = -FRAME_W / 2;
        sprite.y = -FRAME_H / 2;
        sprite.alpha = 1.0;
        const zIndex = SLOT_Z_ORDER[recipe.slot] ?? DEFAULT_Z;

        this._spriteSheets.set(sprite, texture);

        sprites.push({ sprite, zIndex });
        loaded++;
      }

      const container = new Container();
      container.eventMode = 'none';
      container.sortableChildren = true;

      sprites.sort((a, b) => a.zIndex - b.zIndex);

      for (const { sprite, zIndex } of sprites) {
        sprite.zIndex = zIndex;
        container.addChild(sprite);
        this._currentSprites.push(sprite);
      }

      container.x = CANVAS_WIDTH / 2;
      container.y = CANVAS_HEIGHT / 2;

      this._pixiApp.stage.addChild(container);
      this._characterContainer = container;
      this.loadedLayers = loaded;
      this.missingAssets = missing;

      this.debug('lpcWalk.reload.done', {
        loaded,
        total: recipes.length,
        missing,
        stageChildren: this._pixiApp.stage.children.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcWalk.renderFailed', { error: message });
    }
  }

  /**
   * Per-frame sprite texture update. Creates a new Texture from the
   * same source with the updated frame rectangle (Texture.frame is
   * read-only in PixiJS v8).
   */
  private _updateFramePositions(): void {
    const frame = this.animFrame;
    const dir = this._currentDirection;

    for (const sprite of this._currentSprites) {
      const sheetTexture = this._spriteSheets.get(sprite);
      if (!sheetTexture) {
        continue;
      }

      const columns = Math.max(1, Math.floor(sheetTexture.width / FRAME_W));
      const col = frame % columns;
      const x = col * FRAME_W;
      const y = dir * FRAME_H;

      if (x + FRAME_W <= sheetTexture.width && y + FRAME_H <= sheetTexture.height) {
        const newTexture = new Texture({
          source: sheetTexture.source,
          frame: new Rectangle(x, y, FRAME_W, FRAME_H),
        });
        sprite.texture = newTexture;
      }
    }
  }

  private async _loadWalkSheet(assetId: string): Promise<Texture | null> {
    const cacheKey = assetId;
    const cached = this._sheetCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const texture = await loadLpcSheet(assetId, LpcAnimationState.Walk);
      if (texture === Texture.EMPTY) {
        return null;
      }
      this._sheetCache.set(cacheKey, texture);
      return texture;
    } catch {
      return null;
    }
  }

  private _destroyAllSprites(): void {
    for (const sprite of this._currentSprites) {
      this._spriteSheets.delete(sprite);
      sprite.destroy();
    }
    this._currentSprites = [];

    if (this._characterContainer) {
      if (this._characterContainer.parent) {
        this._characterContainer.parent.removeChild(this._characterContainer);
      }
      this._characterContainer.destroy({ children: true });
      this._characterContainer = undefined;
    }
  }

  // ── Private: keyboard ─────────────────────────────────────────────

  private _addKeyboardListeners(): void {
    this.debug('lpcWalk.keyboard.attach');
    window.addEventListener('keydown', this._onKeyDownBound);
    window.addEventListener('keyup', this._onKeyUpBound);
  }

  private _removeKeyboardListeners(): void {
    this.debug('lpcWalk.keyboard.detach');
    window.removeEventListener('keydown', this._onKeyDownBound);
    window.removeEventListener('keyup', this._onKeyUpBound);
  }

  private _onKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key in this._keysDown) {
      event.preventDefault();
      const wasPressed = this._keysDown[key];
      this._keysDown[key] = true;
      if (!wasPressed) {
        this.debug('lpcWalk.key.down', { key });
      }
    }
  }

  private _onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key in this._keysDown) {
      this._keysDown[key] = false;
      this.debug('lpcWalk.key.up', { key });
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

export const getLpcWalkTestViewModel = (
  options: LpcWalkTestViewModelOptions,
): LpcWalkTestViewModelInterface => LpcWalkTestViewModel.create(options);
