// packages/frontend/engine/src/rendering/weather_overlay.ts
// ---------------------------------------------------------------------------
// WeatherOverlay — full-screen quad with procedural rain streak shader
//
// Contract C-213: Environment, Time, and Weather Core System
//
// Creates a viewport-aligned quad that renders procedural weather effects
// (rain, snow, fog) using WGSL fragment shaders. The quad sits at the top
// of the display list and is composited over the game scene.
//
// Performance: the quad is a single 4-vertex mesh with a single draw call.
// All weather variation is computed in the fragment shader — no CPU-side
// particle simulation overhead.
// ---------------------------------------------------------------------------

import { type Container, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import { ENV_UBO_OFFSETS } from '../environment/environment_ubo.ts';

// ---------------------------------------------------------------------------
// WGSL rain streak shader
// ---------------------------------------------------------------------------

/** Full-screen viewport quad vertex positions (NDC). */
const QUAD_POSITIONS = new Float32Array([
  -1,
  -1, // bottom-left
  1,
  -1, // bottom-right
  -1,
  1, // top-left
  1,
  1, // top-right
]);

/** Full-screen viewport quad UV coordinates. */
const QUAD_UVS = new Float32Array([
  0,
  0, // bottom-left
  1,
  0, // bottom-right
  0,
  1, // top-left
  1,
  1, // top-right
]);

/** Quad indices for two-triangle strip. */
const QUAD_INDICES = new Uint32Array([0, 1, 2, 1, 3, 2]);

/**
 * WGSL vertex shader for the full-screen weather quad.
 *
 * Passes through UV coordinates to the fragment shader.
 */
const WEATHER_VERTEX_WGSL = /* wgsl */ `
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
 * WGSL fragment shader for procedural rain streaks.
 */
const RAIN_FRAGMENT_WGSL = /* wgsl */ `
  struct EnvUniforms {
    uAmbientColor: vec4<f32>,
    uShadowColor: vec4<f32>,
    uAmbientIntensity: f32,
    uLocalTime: f32,
    uWindVelocity: f32,
    uRainIntensity: f32,
  };

  @group(0) @binding(0) var<uniform> env: EnvUniforms;

  // Simple 2D hash function for pseudo-random values
  fn hash2(p: vec2<f32>) -> vec2<f32> {
    let h = vec2<f32>(
      dot(p, vec2<f32>(127.1, 311.7)),
      dot(p, vec2<f32>(269.5, 183.3)),
    );
    return fract(sin(h) * 43758.5453);
  }

  // Smoothstep function for fade transitions
  fn smoothstep_f(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  @fragment
  fn main(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
    let intensity = env.uRainIntensity;
    let wind = env.uWindVelocity;

    // No rain — fully transparent
    if (intensity <= 0.01) {
      return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    let time = env.uLocalTime * 0.5;
    let aspectUV = vUV;

    // ── Primary rain layer (large drops, fast) ──
    let scale = intensity * 25.0 + 5.0;
    let cell = floor(vec2<f32>(aspectUV.x * 30.0, aspectUV.y * 30.0));

    let cellHash = hash2(cell);

    let dropThreshold = 1.0 - intensity * 0.6;
    if (cellHash.x > dropThreshold) {
      let scroll = (time * (1.0 + cellHash.y * 2.0)) % 1.0;

      let subUV = fract(vec2<f32>(
        aspectUV.x * 30.0 + wind * scroll * 0.3,
        aspectUV.y * 30.0 - scroll,
      ));

      let streakWidth = 0.08;
      let streakHeight = 0.3;

      let inStreak =
        abs(subUV.x - 0.5) < streakWidth &&
        subUV.y > 0.0 &&
        subUV.y < streakHeight;

      if (inStreak) {
        let fade = smoothstep_f(0.0, 0.05, subUV.y) *
                   (1.0 - smoothstep_f(streakHeight - 0.05, streakHeight, subUV.y));
        let alpha = fade * intensity * 0.35;
        return vec4<f32>(0.55, 0.65, 0.85, alpha);
      }
    }

    // ── Secondary rain layer (smaller drops, slower) ──
    let fineCell = floor(vec2<f32>(aspectUV.x * 60.0, aspectUV.y * 60.0));
    let fineHash = hash2(fineCell);

    let fineThreshold = 1.0 - intensity * 0.4;
    if (fineHash.x > fineThreshold) {
      let fineScroll = (time * (0.6 + fineHash.y * 1.0)) % 1.0;

      let fineSubUV = fract(vec2<f32>(
        aspectUV.x * 60.0 + wind * fineScroll * 0.2,
        aspectUV.y * 60.0 - fineScroll,
      ));

      let fineWidth = 0.04;
      let fineHeight = 0.15;

      let inFineStreak =
        abs(fineSubUV.x - 0.5) < fineWidth &&
        fineSubUV.y > 0.0 &&
        fineSubUV.y < fineHeight;

      if (inFineStreak) {
        let fineFade = smoothstep_f(0.0, 0.02, fineSubUV.y) *
                       (1.0 - smoothstep_f(fineHeight - 0.02, fineHeight, fineSubUV.y));
        let alpha = fineFade * intensity * 0.2;
        return vec4<f32>(0.5, 0.6, 0.8, alpha);
      }
    }

    // ── Fog effect (subtle screen-darkening at high rain intensity) ──
    let fogFactor = intensity * 0.08;
    if (fogFactor > 0.0) {
      let fogNoise = hash2(vec2<f32>(
        aspectUV.x * 10.0 + time * 0.02,
        aspectUV.y * 10.0,
      ));
      let fog = fogFactor * (0.5 + fogNoise.x * 0.5);
      return vec4<f32>(0.2, 0.22, 0.28, fog);
    }

    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
`;

// ---------------------------------------------------------------------------
// GLSL fallback shaders (WebGL2)
//
// Contract C-213: Environment system must work with both WebGPU and
// WebGL2 render preferences. These GLSL shaders provide identical
// behaviour to the WGSL versions above.
// ---------------------------------------------------------------------------

/** GLSL vertex shader for the full-screen weather quad. */
const WEATHER_VERTEX_GLSL = /* glsl */ `#version 300 es

  in vec2 aPosition;
  in vec2 aUV;

  out vec2 vUV;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vUV = aUV;
  }
`;

/** GLSL fragment shader for procedural rain streaks. */
const WEATHER_FRAGMENT_GLSL = /* glsl */ `#version 300 es
  precision highp float;

  in vec2 vUV;
  out vec4 outColor;

  // ── Environment uniforms (matching EnvUniforms layout) ──
  uniform vec4 uAmbientColor;
  uniform vec4 uShadowColor;
  uniform float uAmbientIntensity;
  uniform float uLocalTime;
  uniform float uWindVelocity;
  uniform float uRainIntensity;

  vec2 hash2(vec2 p) {
    vec2 h = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(h) * 43758.5453);
  }

  void main() {
    float intensity = uRainIntensity;
    float wind = uWindVelocity;

    if (intensity <= 0.01) {
      outColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }

    float time = uLocalTime * 0.5;

    // ── Primary rain layer (large drops, fast) ──
    vec2 cell = floor(vec2(vUV.x * 30.0, vUV.y * 30.0));
    vec2 cellHash = hash2(cell);

    float dropThreshold = 1.0 - intensity * 0.6;
    if (cellHash.x > dropThreshold) {
      float scroll = mod(time * (1.0 + cellHash.y * 2.0), 1.0);

      vec2 subUV = fract(vec2(
        vUV.x * 30.0 + wind * scroll * 0.3,
        vUV.y * 30.0 - scroll
      ));

      float streakWidth = 0.08;
      float streakHeight = 0.3;

      bool inStreak = abs(subUV.x - 0.5) < streakWidth &&
                      subUV.y > 0.0 &&
                      subUV.y < streakHeight;

      if (inStreak) {
        float fade = smoothstep(0.0, 0.05, subUV.y) *
                     (1.0 - smoothstep(streakHeight - 0.05, streakHeight, subUV.y));
        float alpha = fade * intensity * 0.35;
        outColor = vec4(0.55, 0.65, 0.85, alpha);
        return;
      }
    }

    // ── Secondary rain layer (smaller drops, slower) ──
    vec2 fineCell = floor(vec2(vUV.x * 60.0, vUV.y * 60.0));
    vec2 fineHash = hash2(fineCell);

    float fineThreshold = 1.0 - intensity * 0.4;
    if (fineHash.x > fineThreshold) {
      float fineScroll = mod(time * (0.6 + fineHash.y * 1.0), 1.0);

      vec2 fineSubUV = fract(vec2(
        vUV.x * 60.0 + wind * fineScroll * 0.2,
        vUV.y * 60.0 - fineScroll
      ));

      float fineWidth = 0.04;
      float fineHeight = 0.15;

      bool inFineStreak = abs(fineSubUV.x - 0.5) < fineWidth &&
                          fineSubUV.y > 0.0 &&
                          fineSubUV.y < fineHeight;

      if (inFineStreak) {
        float fineFade = smoothstep(0.0, 0.02, fineSubUV.y) *
                         (1.0 - smoothstep(fineHeight - 0.02, fineHeight, fineSubUV.y));
        float alpha = fineFade * intensity * 0.2;
        outColor = vec4(0.5, 0.6, 0.8, alpha);
        return;
      }
    }

    // ── Fog effect ──
    float fogFactor = intensity * 0.08;
    if (fogFactor > 0.0) {
      vec2 fogNoise = hash2(vec2(vUV.x * 10.0 + time * 0.02, vUV.y * 10.0));
      float fog = fogFactor * (0.5 + fogNoise.x * 0.5);
      outColor = vec4(0.2, 0.22, 0.28, fog);
      return;
    }

    outColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
`;

// ---------------------------------------------------------------------------
// WeatherOverlay class
// ---------------------------------------------------------------------------

/** Options for {@link WeatherOverlay.create}. */
export type WeatherOverlayOptions = {
  /** The container to add the overlay quad to. */
  parent: Container;
};

/**
 * Full-screen procedural weather overlay.
 *
 * Renders rain streaks, fog, and (future) snow effects using a single
 * WGSL-shaded quad. The quad covers the viewport and is composited over
 * the game scene.
 */
export class WeatherOverlay {
  /** The PixiJS Mesh rendering the full-screen quad. */
  private readonly _mesh: Mesh<MeshGeometry, Shader>;

  /** The UniformGroup bound to the WGSL shader. */
  private readonly _uniformGroup: UniformGroup;

  /** Whether the mesh has been added to the parent. */
  private _attached = false;

  /** The parent container. */
  private readonly _parent: Container;

  constructor(options: WeatherOverlayOptions) {
    this._parent = options.parent;

    // Create a UniformGroup matching the EnvUniforms struct layout.
    // PixiJS v8 UniformGroup maps to @group(0) @binding(0) by default
    // for the first uniform group on a custom Shader.
    this._uniformGroup = new UniformGroup({
      uAmbientColor: { value: new Float32Array(4), type: 'vec4<f32>' },
      uShadowColor: { value: new Float32Array(4), type: 'vec4<f32>' },
      uAmbientIntensity: { value: 0, type: 'f32' },
      uLocalTime: { value: 0, type: 'f32' },
      uWindVelocity: { value: 0, type: 'f32' },
      uRainIntensity: { value: 0, type: 'f32' },
    });

    // Build the quad geometry (PixiJS v8 API: positions, uvs, indices)
    const geometry = new MeshGeometry({
      positions: QUAD_POSITIONS,
      uvs: QUAD_UVS,
      indices: QUAD_INDICES,
    });

    // Build the shader with both WGSL (WebGPU) and GLSL (WebGL2 fallback)
    const shader = Shader.from({
      gpu: {
        vertex: {
          source: WEATHER_VERTEX_WGSL,
          entryPoint: 'main',
        },
        fragment: {
          source: RAIN_FRAGMENT_WGSL,
          entryPoint: 'main',
        },
      },
      gl: {
        vertex: WEATHER_VERTEX_GLSL,
        fragment: WEATHER_FRAGMENT_GLSL,
      },
    });

    this._mesh = new Mesh({
      geometry,
      shader,
    });

    this._mesh.label = 'weather-overlay';
    this._mesh.eventMode = 'none';

    // Position the mesh at the top of the display list
    this._mesh.zIndex = 9999;
  }

  /**
   * Attaches the overlay quad to the parent container.
   */
  attach(): void {
    if (this._attached) {
      return;
    }
    this._parent.addChild(this._mesh);
    this._attached = true;
  }

  /**
   * Removes the overlay quad from the parent container.
   */
  detach(): void {
    if (!this._attached) {
      return;
    }
    this._parent.removeChild(this._mesh);
    this._attached = false;
  }

  /**
   * Updates the weather shader uniforms from the environment UBO.
   *
   * Called once per frame from the main thread's render loop.
   *
   * @param environmentUBO - The Float32Array from the worker's environment system.
   */
  update(environmentUBO: Float32Array): void {
    if (!this._attached) {
      return;
    }

    const ambient = this._uniformGroup.uniforms.uAmbientColor as Float32Array;
    ambient[0] = environmentUBO[ENV_UBO_OFFSETS.ambientColor + 0] ?? 0;
    ambient[1] = environmentUBO[ENV_UBO_OFFSETS.ambientColor + 1] ?? 0;
    ambient[2] = environmentUBO[ENV_UBO_OFFSETS.ambientColor + 2] ?? 0;
    ambient[3] = environmentUBO[ENV_UBO_OFFSETS.ambientColor + 3] ?? 0;

    const shadow = this._uniformGroup.uniforms.uShadowColor as Float32Array;
    shadow[0] = environmentUBO[ENV_UBO_OFFSETS.shadowColor + 0] ?? 0;
    shadow[1] = environmentUBO[ENV_UBO_OFFSETS.shadowColor + 1] ?? 0;
    shadow[2] = environmentUBO[ENV_UBO_OFFSETS.shadowColor + 2] ?? 0;
    shadow[3] = environmentUBO[ENV_UBO_OFFSETS.shadowColor + 3] ?? 0;

    this._uniformGroup.uniforms.uAmbientIntensity =
      environmentUBO[ENV_UBO_OFFSETS.ambientIntensity] ?? 0;
    this._uniformGroup.uniforms.uLocalTime = environmentUBO[ENV_UBO_OFFSETS.localTime] ?? 0;
    this._uniformGroup.uniforms.uWindVelocity = environmentUBO[ENV_UBO_OFFSETS.windVelocity] ?? 0;
    this._uniformGroup.uniforms.uRainIntensity = environmentUBO[ENV_UBO_OFFSETS.rainIntensity] ?? 0;

    this._uniformGroup.update();
  }

  /**
   * Cleans up GPU resources.
   *
   * Must be called when the overlay is no longer needed to prevent
   * memory leaks and zombie render objects.
   */
  destroy(): void {
    if (this._attached) {
      this.detach();
    }
    this._mesh.geometry.destroy(true);
  }

  // -----------------------------------------------------------------------
  // Static factory
  // -----------------------------------------------------------------------

  /**
   * Creates a new WeatherOverlay and attaches it to the given parent
   * container.
   */
  static create(options: WeatherOverlayOptions): WeatherOverlay {
    const overlay = new WeatherOverlay(options);
    overlay.attach();
    return overlay;
  }
}
