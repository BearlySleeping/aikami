// packages/frontend/engine/src/rendering/weather/atmosphere_overlay.ts
// ---------------------------------------------------------------------------
// AtmosphereOverlay — the full-screen half of the weather FX system.
//
// This pass exists for *air*, not for drops. Precipitation is drawn by
// `RainRenderer` as real particles; everything left here is the low-frequency
// haze and darkening that makes heavy rain feel like weather rather than a
// sprite layer.
//
// What it deliberately does NOT do any more:
//   - no per-drop generation. The previous implementation reconstructed rain
//     from a 30x30 / 60x60 hash grid inside this shader, which produced the
//     bright square "confetti" artefact this refactor removes: grid cells were
//     computed in uncorrected UV space (so square in UV, 16:9 rectangles on
//     screen), each cell resolved to a small filled rectangle, and the
//     sin-based hash is precision-unstable across GPU implementations.
//   - no early returns selecting one effect over another. Haze is a single
//     composed expression, so it never flickers on and off per pixel.
//
// It is also the only place the weather stack touches the environment UBO's
// *shape* — and it does not: it takes a small renderer-specific uniform group
// (`fxTime`, intensity, wind, viewport, atmosphere strength). Day/night
// lighting stays the tilemap's job.
// ---------------------------------------------------------------------------

import { Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import {
  ATMOSPHERE_DEPTH_MAX,
  ATMOSPHERE_DEPTH_MIN,
  ATMOSPHERE_DRIFT_PER_SECOND,
  ATMOSPHERE_HAZE_DARK,
  ATMOSPHERE_HAZE_LIGHT,
  ATMOSPHERE_NOISE_CELL_PX,
  ATMOSPHERE_NOISE_FLOOR,
  ATMOSPHERE_NOISE_RANGE,
} from './weather_fx_config.ts';

/**
 * Formats a number as a float literal for GLSL/WGSL.
 *
 * Interpolating a bare JS number would emit `1` for a whole value, which is an
 * int literal in both shading languages; the shader sources below are built
 * from the config constants so art direction lives in exactly one file.
 */
const floatLiteral = (value: number): string => value.toFixed(4);

// ---------------------------------------------------------------------------
// Quad geometry
// ---------------------------------------------------------------------------

/** Full-screen viewport quad vertex positions (NDC). */
const QUAD_POSITIONS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

/** Full-screen viewport quad UV coordinates — (0,0) bottom-left, (1,1) top-right. */
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

/** Quad indices for two triangles. */
const QUAD_INDICES = new Uint32Array([0, 1, 2, 1, 3, 2]);

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

/** WGSL vertex shader — NDC passthrough, no projection needed. */
const ATMOSPHERE_VERTEX_WGSL = /* wgsl */ `
  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vUV: vec2<f32>,
  };

  @vertex
  fn main(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
  ) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(aPosition, 0.0, 1.0);
    output.vUV = aUV;
    return output;
  }
`;

/**
 * WGSL fragment shader — subtle haze, darkening and a vertical depth gradient.
 *
 * Kept behaviourally identical to the GLSL version below. Today's engine runs
 * the WebGL2 path (`rendererPreference` defaults to `'webgl'`), so this is the
 * maintained-but-inert twin; it exists so a future WebGPU renderer does not
 * silently lose the atmosphere pass.
 */
const ATMOSPHERE_FRAGMENT_WGSL = /* wgsl */ `
  struct FxUniforms {
    fxTime: f32,
    rainIntensity: f32,
    wind: f32,
    atmosphereStrength: f32,
    viewportWidth: f32,
    viewportHeight: f32,
  };

  @group(0) @binding(0) var<uniform> fx: FxUniforms;

  // Integer-domain hash (Hoskins). Chosen over fract(sin(x) * k) because that
  // construction loses precision in f32 on some drivers and returns visibly
  // correlated values — the source of the old "random bright pixel" noise.
  fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Value noise with smoothstep interpolation: C1-continuous, so no cell edges
  // are visible even at the very low frequencies used here.
  fn valueNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2<f32>(1.0, 0.0));
    let c = hash21(i + vec2<f32>(0.0, 1.0));
    let d = hash21(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  @fragment
  fn main(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
    // Screen-space coordinates so the haze cells stay square on every aspect
    // ratio and keep the same physical size on every display.
    var noiseCoord = vec2<f32>(vUV.x * fx.viewportWidth, vUV.y * fx.viewportHeight) /
      ${floatLiteral(ATMOSPHERE_NOISE_CELL_PX)};
    // Very slow drift — enough that heavy weather breathes, far too slow to
    // read as a moving pattern.
    noiseCoord = noiseCoord + vec2<f32>(
      fx.fxTime * ${floatLiteral(ATMOSPHERE_DRIFT_PER_SECOND)},
      fx.fxTime * ${floatLiteral(ATMOSPHERE_DRIFT_PER_SECOND * 0.55)},
    );

    let noise = valueNoise(noiseCoord);

    // Distant geometry (the top of the frame) sits behind more atmosphere. The
    // gradient is what reads as *depth*; a flat wash at the same mean alpha
    // just looks like a dirty screen.
    let depth = mix(
      ${floatLiteral(ATMOSPHERE_DEPTH_MIN)},
      ${floatLiteral(ATMOSPHERE_DEPTH_MAX)},
      vUV.y,
    );
    let alpha = fx.atmosphereStrength * depth *
      (${floatLiteral(ATMOSPHERE_NOISE_FLOOR)} + ${floatLiteral(ATMOSPHERE_NOISE_RANGE)} * noise);

    let haze = mix(
      vec3<f32>(${floatLiteral(ATMOSPHERE_HAZE_DARK[0] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_DARK[1] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_DARK[2] ?? 0)}),
      vec3<f32>(${floatLiteral(ATMOSPHERE_HAZE_LIGHT[0] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_LIGHT[1] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_LIGHT[2] ?? 0)}),
      noise,
    );

    // Premultiplied: PixiJS composites with ONE / ONE_MINUS_SRC_ALPHA.
    return vec4<f32>(haze * alpha, alpha);
  }
`;

/** GLSL vertex shader — NDC passthrough, mirroring the WGSL version. */
const ATMOSPHERE_VERTEX_GLSL = /* glsl */ `#version 300 es

  in vec2 aPosition;
  in vec2 aUV;

  out vec2 vUV;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vUV = aUV;
  }
`;

/** GLSL fragment shader — behaviourally identical to {@link ATMOSPHERE_FRAGMENT_WGSL}. */
const ATMOSPHERE_FRAGMENT_GLSL = /* glsl */ `#version 300 es
  precision highp float;

  in vec2 vUV;
  out vec4 outColor;

  uniform float fxTime;
  uniform float rainIntensity;
  uniform float wind;
  uniform float atmosphereStrength;
  uniform float viewportWidth;
  uniform float viewportHeight;

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 noiseCoord = vec2(vUV.x * viewportWidth, vUV.y * viewportHeight) /
      ${floatLiteral(ATMOSPHERE_NOISE_CELL_PX)};
    noiseCoord += vec2(
      fxTime * ${floatLiteral(ATMOSPHERE_DRIFT_PER_SECOND)},
      fxTime * ${floatLiteral(ATMOSPHERE_DRIFT_PER_SECOND * 0.55)}
    );

    float noise = valueNoise(noiseCoord);

    float depth = mix(
      ${floatLiteral(ATMOSPHERE_DEPTH_MIN)},
      ${floatLiteral(ATMOSPHERE_DEPTH_MAX)},
      vUV.y
    );
    float alpha = atmosphereStrength * depth *
      (${floatLiteral(ATMOSPHERE_NOISE_FLOOR)} + ${floatLiteral(ATMOSPHERE_NOISE_RANGE)} * noise);

    vec3 haze = mix(
      vec3(${floatLiteral(ATMOSPHERE_HAZE_DARK[0] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_DARK[1] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_DARK[2] ?? 0)}),
      vec3(${floatLiteral(ATMOSPHERE_HAZE_LIGHT[0] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_LIGHT[1] ?? 0)}, ${floatLiteral(ATMOSPHERE_HAZE_LIGHT[2] ?? 0)}),
      noise
    );

    outColor = vec4(haze * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------
// AtmosphereOverlay
// ---------------------------------------------------------------------------

/**
 * A full-screen mesh providing heavy-rain haze and atmospheric darkening.
 *
 * Owns its quad geometry, its shader and its uniform group. The caller decides
 * *whether* it is visible (the facade hides it at zero strength), which keeps
 * the shader itself branch-free.
 */
export class AtmosphereOverlay {
  private readonly _mesh: Mesh<MeshGeometry, Shader>;

  private readonly _uniforms: UniformGroup;

  private readonly _geometry: MeshGeometry;

  private readonly _shader: Shader;

  private _destroyed = false;

  constructor() {
    this._uniforms = new UniformGroup({
      fxTime: { value: 0, type: 'f32' },
      rainIntensity: { value: 0, type: 'f32' },
      wind: { value: 0, type: 'f32' },
      atmosphereStrength: { value: 0, type: 'f32' },
      viewportWidth: { value: 1, type: 'f32' },
      viewportHeight: { value: 1, type: 'f32' },
    });

    this._geometry = new MeshGeometry({
      positions: QUAD_POSITIONS,
      uvs: QUAD_UVS,
      indices: QUAD_INDICES,
    });
    // The quad is static; excluding it from PixiJS's buffer GC avoids a
    // per-frame bookkeeping pass over a geometry that never changes.
    this._geometry.autoGarbageCollect = false;

    this._shader = Shader.from({
      gpu: {
        vertex: { source: ATMOSPHERE_VERTEX_WGSL, entryPoint: 'main' },
        fragment: { source: ATMOSPHERE_FRAGMENT_WGSL, entryPoint: 'main' },
      },
      gl: {
        vertex: ATMOSPHERE_VERTEX_GLSL,
        fragment: ATMOSPHERE_FRAGMENT_GLSL,
      },
      resources: { fx: this._uniforms },
    });

    this._mesh = new Mesh({ geometry: this._geometry, shader: this._shader });
    this._mesh.label = 'weather-atmosphere';
    // Decorative: never hit-tested, never interactive.
    this._mesh.eventMode = 'none';
    this._mesh.visible = false;
  }

  /** The mesh to add to the weather root. */
  get mesh(): Mesh<MeshGeometry, Shader> {
    return this._mesh;
  }

  /**
   * Pushes the renderer-specific FX uniforms.
   *
   * @param options - FX clock, smoothed weather state, atmosphere strength and
   *                  the viewport size in CSS pixels.
   */
  update(options: {
    fxTimeSeconds: number;
    rainIntensity: number;
    wind: number;
    atmosphereStrength: number;
    viewportWidth: number;
    viewportHeight: number;
  }): void {
    const uniforms = this._uniforms.uniforms;
    uniforms.fxTime = options.fxTimeSeconds;
    uniforms.rainIntensity = options.rainIntensity;
    uniforms.wind = options.wind;
    uniforms.atmosphereStrength = options.atmosphereStrength;
    uniforms.viewportWidth = Math.max(1, options.viewportWidth);
    uniforms.viewportHeight = Math.max(1, options.viewportHeight);
    this._uniforms.update();
    this._mesh.visible = options.atmosphereStrength > 0;
  }

  /** Releases the quad geometry, shader and its GPU programs. */
  destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._mesh.removeFromParent();
    this._geometry.destroy(true);
    this._shader.destroy(true);
  }
}
