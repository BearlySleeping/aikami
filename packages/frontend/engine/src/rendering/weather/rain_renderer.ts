// packages/frontend/engine/src/rendering/weather/rain_renderer.ts
// ---------------------------------------------------------------------------
// RainRenderer — the precipitation half of the weather FX system.
//
// Two screen-space `ParticleContainer` batches — "far" and "near" — share one
// generated streak texture, so the whole effect is two draw calls regardless
// of how many drops are alive. There is no emitter library: PixiJS v8's native
// particle system is sufficient, and adding a dependency here would buy
// nothing the batch already does.
//
// Design rules this file exists to enforce:
//
//  - **No per-frame allocation.** Pools and their parameter arrays are
//    allocated in `resize()`, which only runs when the viewport (and therefore
//    the drop budget) actually changes. The per-frame loop touches only
//    numbers and existing objects.
//  - **No spawn/destroy churn.** Drops are recycled by wrapping their travel
//    distance inside an off-screen margin. Inactive drops are parked outside
//    the wrap window rather than removed from the batch, so changing intensity
//    never re-uploads the particle buffers.
//  - **Analytic positions.** A drop's position is computed from its seed and
//    the FX clock, not integrated. That is what makes a frozen-clock capture
//    reproducible and a long frame pause harmless.
//  - **Only what changes is dynamic.** Position, rotation and colour are the
//    three attributes that genuinely move; scale and UVs are baked at pool
//    build and left static.
// ---------------------------------------------------------------------------

import { Color, Container, Particle, ParticleContainer, Rectangle, type Texture } from 'pixi.js';
import { createRainStreakTexture } from './rain_texture.ts';
import {
  FAR_RAIN_PROFILE,
  NEAR_RAIN_PROFILE,
  RAIN_STREAK_TEXTURE_HEIGHT,
  type RainBatchProfile,
  WEATHER_FX_SEED,
} from './weather_fx_config.ts';
import {
  buildRainDropParams,
  type RainDropParams,
  type RainWrapGeometry,
  resolveRainAlphaScale,
  resolveRainBatchCount,
  resolveRainPoolSize,
  resolveRainWrapGeometry,
  wrapRange,
} from './weather_fx_math.ts';

/** Where inactive drops are parked. Far outside any plausible viewport. */
const PARKED_COORDINATE = -10_000;

/**
 * Packs a drop's tint and alpha into the 32-bit colour the particle pipe
 * uploads.
 *
 * The pool is iterated through `IParticle` (the container's element type),
 * which guarantees `color` but not the `alpha` convenience setter that
 * `Particle` adds. Writing the packed value directly is also one property
 * assignment instead of a setter that re-derives the tint on every call — and
 * this runs once per drop per frame.
 *
 * @param tintBgr - Tint pre-packed by PixiJS's own colour convention.
 * @param alpha - Alpha in `[0, 1]`; clamped like `Particle.alpha` does.
 */
const packParticleColor = (tintBgr: number, alpha: number): number => {
  const byte = (Math.min(1, Math.max(0, alpha)) * 255) | 0;
  return (tintBgr | (byte << 24)) >>> 0;
};

/** One depth layer's live state: its container, its pool and its geometry. */
type RainBatch = {
  profile: RainBatchProfile;
  container: ParticleContainer;
  bounds: Rectangle;
  params: RainDropParams;
  geometry: RainWrapGeometry;
  poolSize: number;
  activeCount: number;
  /** Batch tint, pre-packed to PixiJS's internal BGR convention. */
  tintBgr: number;
};

/** Options for {@link RainRenderer}. */
export type RainRendererOptions = {
  /**
   * Base PRNG seed. Far and near batches derive their own streams from it so
   * the two layers never share a drop pattern.
   */
  seed?: number;
};

/**
 * Renders rain as two screen-space particle batches.
 *
 * The caller owns the FX clock and the transition state: this class is told
 * *what the rain looks like right now* and only has to draw it.
 */
export class RainRenderer {
  /** Container holding both depth batches. Add this to the weather root. */
  private readonly _container: Container;

  /** Background rain: many, small, faint. */
  private _farBatch: RainBatch | undefined;

  /** Foreground rain: few, long, bright. */
  private _nearBatch: RainBatch | undefined;

  private readonly _seed: number;

  /** The shared streak texture. Owned by this renderer. */
  private readonly _texture: Texture;

  private _viewportWidth = 0;

  private _viewportHeight = 0;

  constructor(options: RainRendererOptions) {
    this._seed = options.seed ?? WEATHER_FX_SEED;
    this._texture = createRainStreakTexture();

    this._container = new Container();
    this._container.label = 'weather-rain';
    // The FX hierarchy is decorative — never hit-tested, never interactive.
    this._container.eventMode = 'none';
    this._container.interactiveChildren = false;
  }

  /** The container holding both rain batches. */
  get container(): Container {
    return this._container;
  }

  /** Live drop count in the background batch (diagnostics). */
  get farCount(): number {
    return this._farBatch?.activeCount ?? 0;
  }

  /** Live drop count in the foreground batch (diagnostics). */
  get nearCount(): number {
    return this._nearBatch?.activeCount ?? 0;
  }

  /** Pooled drop capacity across both batches (diagnostics). */
  get poolSize(): number {
    return (this._farBatch?.poolSize ?? 0) + (this._nearBatch?.poolSize ?? 0);
  }

  /**
   * Mean streak length of the background batch, in texture-scale units.
   *
   * Diagnostics only. The far/near depth separation is an art requirement that
   * a vision model cannot reliably measure on a downscaled capture, so it is
   * asserted against the renderer's own numbers instead.
   */
  get farMeanScaleY(): number {
    return this._meanScaleY(this._farBatch);
  }

  /** Mean streak length of the foreground batch, in texture-scale units. */
  get nearMeanScaleY(): number {
    return this._meanScaleY(this._nearBatch);
  }

  /**
   * Recomputes the viewport, drop budgets and wrap windows.
   *
   * Pools are rebuilt only when the required capacity actually changes, so a
   * resize that does not alter the budget (or a no-op resize) costs nothing
   * and never disturbs the drops already on screen.
   *
   * @param options - The new viewport size in CSS pixels.
   */
  resize(options: { width: number; height: number }): void {
    const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 0;
    const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 0;
    this._viewportWidth = width;
    this._viewportHeight = height;

    this._farBatch = this._syncBatch({
      batch: this._farBatch,
      name: 'far',
      profile: FAR_RAIN_PROFILE,
      seed: this._seed,
    });
    this._nearBatch = this._syncBatch({
      batch: this._nearBatch,
      name: 'near',
      profile: NEAR_RAIN_PROFILE,
      // A distinct stream keeps the near layer from echoing the far layer.
      seed: this._seed ^ 0x9e37_79b9,
    });

    this._container.boundsArea = new Rectangle(0, 0, width, height);
  }

  /**
   * Advances the rain by one rendered frame.
   *
   * @param options - The frozen/animated FX clock, the smoothed intensity and
   *                  the wind-derived streak tilt.
   */
  update(options: { fxTimeSeconds: number; intensity: number; slantRadians: number }): void {
    const { fxTimeSeconds, intensity, slantRadians } = options;
    // tan() once per frame, not once per drop.
    const tanSlant = Math.tan(slantRadians);
    const alphaScale = resolveRainAlphaScale(intensity);
    const shared = { fxTimeSeconds, intensity, alphaScale, slantRadians, tanSlant };
    this._updateBatch({ batch: this._farBatch, ...shared });
    this._updateBatch({ batch: this._nearBatch, ...shared });
  }

  /**
   * Zeroes the live drop counts without touching a single particle.
   *
   * Called when the whole hierarchy is hidden — clear weather, or an interior
   * scene. No drop is rendered and the per-drop loop is skipped, but the batch
   * counters would otherwise keep reporting the previous storm's population and
   * make diagnostics lie. Particle transforms are deliberately left in place:
   * nothing is drawn, the frame stays free, and a later storm resumes without a
   * buffer re-upload.
   */
  clearActiveCounts(): void {
    if (this._farBatch) {
      this._farBatch.activeCount = 0;
    }
    if (this._nearBatch) {
      this._nearBatch.activeCount = 0;
    }
  }

  /**
   * Releases every GPU resource this renderer owns.
   *
   * Idempotent: the shared texture is freed once, after both batches that
   * reference it are gone.
   */
  destroy(): void {
    this._farBatch?.container.destroy({ children: true, texture: false, textureSource: false });
    this._nearBatch?.container.destroy({ children: true, texture: false, textureSource: false });
    this._farBatch = undefined;
    this._nearBatch = undefined;
    this._container.destroy({ children: false, texture: false, textureSource: false });
    if (!this._texture.destroyed) {
      this._texture.destroy(true);
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Brings a batch in line with the current viewport, rebuilding its pool only
   * when the drop budget changed.
   */
  private _syncBatch(options: {
    batch: RainBatch | undefined;
    name: string;
    profile: RainBatchProfile;
    seed: number;
  }): RainBatch | undefined {
    const { batch, name, profile, seed } = options;
    const poolSize = resolveRainPoolSize({
      profile,
      viewportWidth: this._viewportWidth,
      viewportHeight: this._viewportHeight,
    });
    const geometry = resolveRainWrapGeometry({
      profile,
      viewportWidth: this._viewportWidth,
      viewportHeight: this._viewportHeight,
      textureHeight: RAIN_STREAK_TEXTURE_HEIGHT,
    });

    if (batch) {
      batch.geometry = geometry;
      batch.bounds.width = this._viewportWidth;
      batch.bounds.height = this._viewportHeight;
      batch.container.boundsArea = batch.bounds;
      if (batch.poolSize === poolSize) {
        return batch;
      }
      // Capacity genuinely changed — the old pool is discarded rather than
      // grown in place, because every particle's parameters are positional.
      batch.container.removeFromParent();
      batch.container.destroy({ children: true, texture: false, textureSource: false });
    }

    if (poolSize === 0) {
      return undefined;
    }

    const bounds = new Rectangle(0, 0, this._viewportWidth, this._viewportHeight);
    const container = new ParticleContainer({
      texture: this._texture,
      // Without an explicit boundsArea a ParticleContainer reports empty
      // bounds and is culled as invisible.
      boundsArea: bounds,
      // Position, rotation and colour are the only attributes that move.
      // Scale (vertex) and UVs are fixed at build time.
      dynamicProperties: { position: true, rotation: true, color: true, vertex: false, uvs: false },
    });
    container.label = `weather-rain-${name}`;
    container.eventMode = 'none';
    container.interactiveChildren = false;

    const params = buildRainDropParams({ profile, seed, count: poolSize });
    // Pre-pack the tint once: `Particle.tint`'s setter does this internally via
    // `Color.shared`, but the per-frame path writes `color` directly.
    const tintBgr = Color.shared.setValue(profile.tint).toBgrNumber();
    const particles: Particle[] = [];
    for (let index = 0; index < poolSize; index++) {
      particles.push(
        new Particle({
          texture: this._texture,
          x: PARKED_COORDINATE,
          y: PARKED_COORDINATE,
          // Anchor at the centre so wind rotation tilts the streak about its
          // middle instead of swinging it around a corner.
          anchorX: 0.5,
          anchorY: 0.5,
          scaleX: params.scaleX[index] ?? profile.scaleX,
          scaleY: params.scaleY[index] ?? profile.scaleY,
          tint: profile.tint,
          // Starts fully transparent; the per-frame loop writes `color`.
          alpha: 0,
        }),
      );
    }
    // Bulk assignment: one view update instead of one per particle.
    container.particleChildren.push(...particles);
    container.update();

    this._container.addChild(container);

    return {
      profile,
      container,
      bounds,
      params,
      geometry,
      poolSize,
      activeCount: 0,
      tintBgr,
    };
  }

  /**
   * Mean streak length of a batch's pool, or 0 when the batch is absent.
   *
   * @param batch - The batch to measure.
   */
  private _meanScaleY(batch: RainBatch | undefined): number {
    if (!batch || batch.poolSize === 0) {
      return 0;
    }
    let total = 0;
    for (let index = 0; index < batch.poolSize; index++) {
      total += batch.params.scaleY[index] ?? 0;
    }
    return total / batch.poolSize;
  }

  /** Recomputes one batch's live drops and writes their transforms. */
  private _updateBatch(options: {
    batch: RainBatch | undefined;
    fxTimeSeconds: number;
    intensity: number;
    alphaScale: number;
    slantRadians: number;
    tanSlant: number;
  }): void {
    const { batch, fxTimeSeconds, intensity, alphaScale, slantRadians, tanSlant } = options;
    if (!batch) {
      return;
    }

    const activeCount = resolveRainBatchCount({
      profile: batch.profile,
      viewportWidth: this._viewportWidth,
      viewportHeight: this._viewportHeight,
      intensity,
    });
    batch.activeCount = activeCount;

    const { spanX, spanY, marginX, marginY } = batch.geometry;
    const { params, poolSize } = batch;
    const particles = batch.container.particleChildren;

    for (let index = 0; index < poolSize; index++) {
      const particle = particles[index];
      if (!particle) {
        continue;
      }
      if (index >= activeCount) {
        // Parked, not removed: the batch's buffers stay untouched, and a
        // vertex outside the clip volume costs no fill.
        particle.x = PARKED_COORDINATE;
        particle.y = PARKED_COORDINATE;
        continue;
      }
      const fallSpeed = params.fallSpeed[index] ?? 0;
      // Lateral travel is derived from the *same* tilt the streak is drawn
      // at, so the drop moves along the line it is painted on.
      const lateralSpeed = fallSpeed * tanSlant;

      const yTravel = (params.y0Fraction[index] ?? 0) * spanY + fallSpeed * fxTimeSeconds;
      particle.y = wrapRange({ value: yTravel, min: 0, max: spanY }) - marginY;

      const xTravel = (params.x0Fraction[index] ?? 0) * spanX + lateralSpeed * fxTimeSeconds;
      particle.x = wrapRange({ value: xTravel, min: 0, max: spanX }) - marginX;

      particle.rotation = slantRadians;
      particle.color = packParticleColor(batch.tintBgr, (params.alpha[index] ?? 0) * alphaScale);
    }
  }
}
