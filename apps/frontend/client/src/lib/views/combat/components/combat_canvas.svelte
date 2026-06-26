<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/combat_canvas.svelte
  //
  // Lightweight PixiJS canvas rendering two LPC characters for the combat
  // dev page. Player on left, enemy on right. Stacked layer sprites from
  // the LPC asset catalog.
  //
  // Contract: C-166 Diegetic Combat Stage — AC-1 visual feedback
  // -----------------------------------------------------------------------

  import { Application, Assets, Container, Sprite, Texture } from 'pixi.js';
  import { onMount } from 'svelte';
  import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
  import { LpcAnimationState } from '$lib/data/lpc_models';

  /** Props */
  type Props = {
    /** Player HP (0–100). Used to tint sprite red when low. */
    playerHp?: number;
    /** Enemy HP (0–100). */
    enemyHp?: number;
    /** Whether to show a dark background vs transparent. */
    showBackground?: boolean;
  };

  const { playerHp = 100, enemyHp = 100, showBackground = true }: Props = $props();

  // ── LPC layer asset IDs (player: knight, enemy: orc-like) ──
  const PLAYER_LAYERS = [
    'body/bodies_male',
    'legs/armour/plate_male',
    'torso/armour/plate_male',
    'head/heads/human_male',
    'hair/xlong_male',
  ] as const;

  const ENEMY_LAYERS = [
    'body/bodies_male',
    'legs/cuffed_male',
    'torso/aprons/apron_male',
    'head/heads/human_male',
    'hair/flat_top_fade_male',
  ] as const;

  /** Layer z-order: body → legs → torso → head → hair (back to front) */
  const Z_ORDER = [0, 2, 1, 3, 4];

  let canvasElement = $state<HTMLCanvasElement>();

  /** PixiJS Application instance. Created in onMount. */
  let app: Application | undefined;

  /** Container for the player character. */
  let playerContainer: Container | undefined;
  /** Container for the enemy character. */
  let enemyContainer: Container | undefined;

  /** Whether sprites are loaded. */
  let isReady = $state(false);

  // ── Lifecycle ───────────────────────────────────────────────────────

  onMount(() => {
    void (async () => {
      const canvas = canvasElement;
      if (!canvas) {
        return;
      }

      try {
        app = new Application();
        await app.init({
          canvas,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          background: showBackground ? 0x1a1a2e : undefined,
          antialias: false,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });

        // Center characters at 25% and 75% of canvas width
        const cx = app.screen.width / 2;
        const groundY = app.screen.height * 0.65;

        // Create player container (left side, facing right)
        playerContainer = new Container();
        playerContainer.x = cx - app.screen.width * 0.25;
        playerContainer.y = groundY;
        playerContainer.scale.set(3);
        app.stage.addChild(playerContainer);

        // Create enemy container (right side, facing left)
        enemyContainer = new Container();
        enemyContainer.x = cx + app.screen.width * 0.25;
        enemyContainer.y = groundY;
        enemyContainer.scale.set(-3, 3); // flip horizontally
        app.stage.addChild(enemyContainer);

        // Load textures for both characters
        await loadCharacterSprites(playerContainer, PLAYER_LAYERS);
        await loadCharacterSprites(enemyContainer, ENEMY_LAYERS);

        // Apply HP tint
        applyHpTint(playerContainer, playerHp);
        applyHpTint(enemyContainer, enemyHp);

        isReady = true;

        // Start idle animation loop
        app.ticker.add(() => {
          idleAnimate(playerContainer, 0.5);
          idleAnimate(enemyContainer, 0.5);
        });

        // Handle resize
        const handleResize = () => {
          if (app && canvas) {
            app.renderer.resize(canvas.clientWidth, canvas.clientHeight);
            // Re-center
            const newCx = app.screen.width / 2;
            if (playerContainer) {
              playerContainer.x = newCx - app.screen.width * 0.25;
            }
            if (enemyContainer) {
              enemyContainer.x = newCx + app.screen.width * 0.25;
            }
          }
        };
        window.addEventListener('resize', handleResize);

        return () => {
          window.removeEventListener('resize', handleResize);
          app?.destroy(true);
          app = undefined;
          isReady = false;
        };
      } catch {
        // Silently fail — the canvas may not be available
      }
    })();
  });

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Loads and stacks LPC layer sprites for a character container. */
  const loadCharacterSprites = async (
    container: Container,
    layerIds: readonly string[],
  ): Promise<void> => {
    // Preload all textures
    const texturePromises = layerIds.map((id) => loadLpcTexture(id));
    const textures = await Promise.all(texturePromises);

    // Add sprites in z-order
    for (const i of Z_ORDER) {
      const tex = textures[i];
      const sprite = new Sprite(tex ?? Texture.EMPTY);
      sprite.anchor.set(0.5, 1); // anchor at bottom-center (feet)
      // Position relative to container center
      sprite.y = 0;
      container.addChild(sprite);
    }
  };

  /** Simple texture cache to avoid reloading. */
  const _textureCache = new Map<string, Texture>();

  /** Loads an LPC texture from the asset catalog. */
  const loadLpcTexture = async (assetId: string): Promise<Texture> => {
    const cached = _textureCache.get(assetId);
    if (cached) {
      return cached;
    }

    try {
      // Use shared LPC asset path resolver (single source of truth)
      const path = getLpcAssetPath('body', assetId, LpcAnimationState.Walk);
      const mod = await import(/* @vite-ignore */ `${path}?url`);
      const url = (mod as { default: string }).default;
      const texture = await Assets.load(url);
      texture.source.scaleMode = 'nearest';
      _textureCache.set(assetId, texture);
      return texture;
    } catch {
      // Fall back to empty texture on load failure
      _textureCache.set(assetId, Texture.EMPTY);
      return Texture.EMPTY;
    }
  };

  /** Applies a red tint based on HP percentage. */
  const applyHpTint = (container: Container | undefined, hp: number): void => {
    if (!container) {
      return;
    }
    const pct = Math.max(0, hp / 100);
    const tint = pct > 0.5 ? 0xffffff : pct > 0.25 ? 0xffcccc : 0xff8888;
    for (const child of container.children) {
      if (child instanceof Sprite) {
        child.tint = tint;
      }
    }
  };

  /** Simple idle animation — subtle breathing via y-scale oscillation. */
  const idleAnimate = (container: Container | undefined, _amplitude: number): void => {
    if (!container) {
      return;
    }
    const t = Date.now() / 1000;
    const breathe = 1 + Math.sin(t * 2) * 0.02;
    // Only scale Y on the main container
    const baseScale = Math.abs(container.scale.x);
    container.scale.y = baseScale * breathe;
  };
</script>

<canvas bind:this={canvasElement} class="w-full h-full block"></canvas>

{#if !isReady}
  <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
    <span class="loading loading-spinner loading-md text-primary/50"></span>
  </div>
{/if}
