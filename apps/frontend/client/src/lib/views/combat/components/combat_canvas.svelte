<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/combat_canvas.svelte
  //
  // Lightweight PixiJS canvas rendering two LPC characters for the combat
  // dev page. Player on left, enemy on right. Stacked layer sprites from
  // the LPC asset catalog. Dev info overlay shows participant count.
  //
  // Contract: C-166 Diegetic Combat Stage — AC-1 visual feedback

  import { Application, Assets, Container, Sprite, Texture } from 'pixi.js';
  import { onMount } from 'svelte';
  import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
  import { LpcAnimationState } from '$lib/data/lpc_models';

  type Props = {
    playerHp?: number;
    enemyHp?: number;
    enemyName?: string;
    showBackground?: boolean;
  };

  const {
    playerHp = 100,
    enemyHp = 100,
    enemyName = 'Enemy',
    showBackground = true,
  }: Props = $props();

  // ── LPC character layers ──
  const PLAYER_LAYERS = [
    'body/bodies_male',
    'legs/cuffed_male',
    'torso/armour/leather_male',
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

  /** Layer z-order: body(0) → legs(2) → torso(1) → head(3) → hair(4) */
  const Z_ORDER = [0, 2, 1, 3, 4];

  let canvasElement = $state<HTMLCanvasElement>();
  let app: Application | undefined;
  let playerContainer: Container | undefined;
  let enemyContainer: Container | undefined;
  let isReady = $state(false);
  let _loaded = false;

  onMount(() => {
    if (_loaded) {
      return;
    }
    _loaded = true;

    const canvas = canvasElement;
    if (!canvas) {
      return;
    }

    void (async () => {
      try {
        app = new Application();
        await app.init({
          canvas,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          background: showBackground ? 0x1a1a2e : undefined,
          antialias: false,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });

        const cx = app.screen.width / 2;
        const groundY = app.screen.height * 0.68;

        // Player — left side
        playerContainer = new Container();
        playerContainer.x = cx - 64;
        playerContainer.y = groundY;
        playerContainer.scale.set(2.5);
        app.stage.addChild(playerContainer);

        // Enemy — right side, mirrored
        enemyContainer = new Container();
        enemyContainer.x = cx + 64;
        enemyContainer.y = groundY;
        enemyContainer.scale.set(2.5, 2.5);
        app.stage.addChild(enemyContainer);

        await loadCharacterSprites(playerContainer, PLAYER_LAYERS, true);
        await loadCharacterSprites(enemyContainer, ENEMY_LAYERS, false);

        applyHpTint(playerContainer, playerHp);
        applyHpTint(enemyContainer, enemyHp);

        // Name labels (PixiJS Text)
        const { Text, TextStyle } = await import('pixi.js');
        const labelStyle = new TextStyle({
          fontSize: 12,
          fill: 0xcccccc,
          fontFamily: 'monospace',
        });
        const playerLabel = new Text({ text: 'Player', style: labelStyle });
        playerLabel.anchor.set(0.5, 0);
        playerLabel.x = playerContainer.x;
        playerLabel.y = groundY - 120;
        app.stage.addChild(playerLabel);

        const enemyLabel = new Text({ text: enemyName, style: labelStyle });
        enemyLabel.anchor.set(0.5, 0);
        enemyLabel.x = enemyContainer.x;
        enemyLabel.y = groundY - 120;
        app.stage.addChild(enemyLabel);

        isReady = true;

        // Idle: very subtle breathing (slow, tiny amplitude)
        app.ticker.add(() => {
          const t = Date.now() / 1000;
          const breathe = 1 + Math.sin(t * 0.8) * 0.005;
          for (const c of [playerContainer, enemyContainer]) {
            if (c) {
              const baseScale = Math.abs(c.scale.x);
              c.scale.y = baseScale * breathe;
            }
          }
        });

        // Resize handler
        const onResize = () => {
          if (!app || !canvas) {
            return;
          }
          app.renderer.resize(canvas.clientWidth, canvas.clientHeight);
          const newCx = app.screen.width / 2;
          if (playerContainer) {
            playerContainer.x = newCx - 64;
          }
          if (enemyContainer) {
            enemyContainer.x = newCx + 64;
          }
          if (playerLabel) {
            playerLabel.x = playerContainer?.x ?? newCx - 64;
          }
          if (enemyLabel) {
            enemyLabel.x = enemyContainer?.x ?? newCx + 64;
          }
        };
        window.addEventListener('resize', onResize);

        return () => {
          window.removeEventListener('resize', onResize);
          app?.destroy(true);
          app = undefined;
          isReady = false;
          _loaded = false;
        };
      } catch {
        _loaded = false;
      }
    })();
  });

  // ── Helpers ────────────────────────────────────────────────

  const loadCharacterSprites = async (
    container: Container,
    layerIds: readonly string[],
    facingRight: boolean,
  ): Promise<void> => {
    const textures = await Promise.all(layerIds.map((id) => loadLpcTexture(id, facingRight)));
    for (const i of Z_ORDER) {
      const tex = textures[i];
      const sprite = new Sprite(tex ?? Texture.EMPTY);
      sprite.anchor.set(0.5, 1);
      sprite.y = 0;
      container.addChild(sprite);
    }
  };

  const _textureCache = new Map<string, Texture>();

  const loadLpcTexture = async (assetId: string, facingRight: boolean): Promise<Texture> => {
    const cached = _textureCache.get(assetId);
    if (cached) {
      return cached;
    }
    try {
      const path = getLpcAssetPath('body', assetId, LpcAnimationState.Walk);
      const mod = await import(/* @vite-ignore */ `${path}?url`);
      const url = (mod as { default: string }).default;
      const baseTexture = await Assets.load(url);
      baseTexture.source.scaleMode = 'nearest';
      // Crop to first frame of Walk spritesheet
      // PixiJS v8: Texture(frame) crops the source to the given rectangle
      // Player faces Right (row 2, y=128), Enemy faces Left (row 1, y=64)
      // Down=row0(0), Left=row1(64), Right=row2(128), Up=row3(192)
      const { Rectangle } = await import('pixi.js');
      const rowY = facingRight ? 128 : 64;
      const frame = new Texture({
        source: baseTexture,
        frame: new Rectangle(0, rowY, 64, 64),
      });
      _textureCache.set(assetId, frame);
      return frame;
    } catch {
      _textureCache.set(assetId, Texture.EMPTY);
      return Texture.EMPTY;
    }
  };

  const applyHpTint = (container: Container | undefined, hp: number): void => {
    if (!container) {
      return;
    }
    const pct = Math.max(0, hp / 100);
    const tint = pct > 0.5 ? 0xffffff : pct > 0.25 ? 0xffcccc : 0xff6666;
    for (const child of container.children) {
      if (child instanceof Sprite) {
        child.tint = tint;
      }
    }
  };
</script>

<div class="relative w-full h-full">
  <canvas bind:this={canvasElement} class="w-full h-full block"></canvas>

  {#if !isReady}
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span class="loading loading-spinner loading-md text-primary/50"></span>
    </div>
  {/if}

  <!-- Dev info overlay -->
  <div class="absolute bottom-2 left-2 pointer-events-none">
    <div
      class="rounded bg-base-100/80 px-2 py-1 text-[10px] font-mono text-base-content/60 backdrop-blur-sm"
    >
      ⚔️ Combatants: 2 (Player vs {enemyName})
    </div>
  </div>
</div>
