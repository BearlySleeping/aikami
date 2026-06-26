<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/combat_canvas.svelte
  //
  // Lightweight PixiJS canvas rendering two LPC characters for combat dev.
  // Player on left, enemy mirrored on right. Stacked layer sprites from LPC
  // asset catalog using shared getLpcAssetPath (single source of truth).
  //
  // Contract: C-166 Diegetic Combat Stage

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

  const Z_ORDER = [0, 2, 1, 3, 4];

  let canvasElement = $state<HTMLCanvasElement>();
  let app: Application | undefined;
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

        const player = new Container();
        player.x = cx - 120;
        player.y = groundY;
        player.scale.set(2.5);
        app.stage.addChild(player);

        const enemy = new Container();
        enemy.x = cx + 120;
        enemy.y = groundY;
        enemy.scale.set(-2.5, 2.5);
        app.stage.addChild(enemy);

        await buildCharacter(player, PLAYER_LAYERS);
        await buildCharacter(enemy, ENEMY_LAYERS);

        tintHp(player, playerHp);
        tintHp(enemy, enemyHp);

        const { Text, TextStyle } = await import('pixi.js');
        const labelStyle = new TextStyle({ fontSize: 12, fill: 0xcccccc, fontFamily: 'monospace' });
        const playerLabel = new Text({ text: 'Player', style: labelStyle });
        playerLabel.anchor.set(0.5, 0);
        playerLabel.x = player.x;
        playerLabel.y = groundY - 120;
        app.stage.addChild(playerLabel);

        const enemyLabel = new Text({ text: enemyName, style: labelStyle });
        enemyLabel.anchor.set(0.5, 0);
        enemyLabel.x = enemy.x;
        enemyLabel.y = groundY - 120;
        app.stage.addChild(enemyLabel);

        isReady = true;

        app.ticker.add(() => {
          const t = Date.now() / 1000;
          const breathe = 1 + Math.sin(t * 0.8) * 0.005;
          for (const c of [player, enemy]) {
            if (c) {
              const baseScale = Math.abs(c.scale.x);
              c.scale.y = baseScale * breathe;
            }
          }
        });

        const onResize = () => {
          if (!app || !canvas) {
            return;
          }
          app.renderer.resize(canvas.clientWidth, canvas.clientHeight);
          const newCx = app.screen.width / 2;
          player.x = newCx - 120;
          enemy.x = newCx + 120;
          playerLabel.x = player.x;
          enemyLabel.x = enemy.x;
        };
        window.addEventListener('resize', onResize);

        return () => {
          window.removeEventListener('resize', onResize);
          app?.destroy(true);
          isReady = false;
          _loaded = false;
        };
      } catch {
        _loaded = false;
      }
    })();
  });

  // ── Helpers ────────────────────────────────────────────────

  const _texCache = new Map<string, Texture>();

  const loadTexture = async (assetId: string): Promise<Texture> => {
    const cached = _texCache.get(assetId);
    if (cached) {
      return cached;
    }
    try {
      const path = getLpcAssetPath('body', assetId, LpcAnimationState.Walk);
      const mod = await import(/* @vite-ignore */ `${path}?url`);
      const loaded = await Assets.load((mod as { default: string }).default);
      loaded.source.scaleMode = 'nearest';
      _texCache.set(assetId, loaded);
      return loaded;
    } catch {
      return Texture.EMPTY;
    }
  };

  const buildCharacter = async (c: Container, ids: readonly string[]) => {
    const texs = await Promise.all(ids.map(loadTexture));
    for (const i of Z_ORDER) {
      const s = new Sprite(texs[i] ?? Texture.EMPTY);
      s.anchor.set(0.5, 1);
      c.addChild(s);
    }
  };

  const tintHp = (c: Container | undefined, hp: number) => {
    if (!c) {
      return;
    }
    const pct = Math.max(0, hp / 100);
    const tint = pct > 0.5 ? 0xffffff : pct > 0.25 ? 0xffcccc : 0xff6666;
    for (const ch of c.children) {
      if (ch instanceof Sprite) {
        ch.tint = tint;
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

  <div class="absolute bottom-2 left-2 pointer-events-none">
    <div
      class="rounded bg-base-100/80 px-2 py-1 text-[10px] font-mono text-base-content/60 backdrop-blur-sm"
    >
      ⚔️ Combatants: 2 (Player vs {enemyName})
    </div>
  </div>
</div>
