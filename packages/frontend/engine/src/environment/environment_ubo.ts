// packages/frontend/engine/src/environment/environment_ubo.ts
// ---------------------------------------------------------------------------
// Environment Uniform Buffer Object — std140-aligned 48-byte layout
//
// Contract C-213: Environment, Time, and Weather Core System
//
// The Float32Array-backed uniform group is designed for direct GPU upload
// via WebGPU writeBuffer or WebGL2 bufferSubData. All fields are tightly
// packed in std140 order with manual alignment enforcement.
//
// Layout (48 bytes, 12 f32 values):
// ┌─────────────────────┬───────────┬────────┬────────────────┐
// │ Variable            │ Type      │ Bytes  │ Aligned Offset │
// ├─────────────────────┼───────────┼────────┼────────────────┤
// │ uAmbientColor       │ vec4<f32> │ 16     │ 0              │
// │ uShadowColor        │ vec4<f32> │ 16     │ 16             │
// │ uAmbientIntensity   │ f32       │ 4      │ 32             │
// │ uLocalTime          │ f32       │ 4      │ 36             │
// │ uWindVelocity       │ f32       │ 4      │ 40             │
// │ uRainIntensity      │ f32       │ 4      │ 44             │
// └─────────────────────┴───────────┴────────┴────────────────┘
// ---------------------------------------------------------------------------

/** Number of Float32 values in the environment uniform buffer. */
export const ENVIRONMENT_UBO_SIZE = 12;

/** Byte size of the environment uniform buffer (48 bytes). */
export const ENVIRONMENT_UBO_BYTES = ENVIRONMENT_UBO_SIZE * Float32Array.BYTES_PER_ELEMENT;

/**
 * Offsets into the Float32Array for each uniform field.
 *
 * These match the std140 layout and must not be changed without updating
 * the corresponding WGSL/GLSL struct definitions.
 */
export const ENV_UBO_OFFSETS = {
  ambientColor: 0, // vec4<f32> — RGBA, 4 floats
  shadowColor: 4, // vec4<f32> — RGBA, 4 floats
  ambientIntensity: 8, // f32 — scalar
  localTime: 9, // f32 — game time in seconds
  windVelocity: 10, // f32 — wind direction × speed scalar
  rainIntensity: 11, // f32 — 0.0 to 1.0 precipitation factor
} as const;

// ---------------------------------------------------------------------------
// Day/night colour presets
//
// Each preset is a 4-component RGBA colour normalised to [0, 1].
// The environment system linearly interpolates between adjacent presets
// based on the current game hour.
// ---------------------------------------------------------------------------

/** Colour preset for midnight (00:00 / 24:00). Deep blue-black. */
export const COLOR_MIDNIGHT: ReadonlyArray<number> = [0.02, 0.02, 0.08, 1.0];

/** Colour preset for dawn (06:00). Soft orange-pink. */
export const COLOR_DAWN: ReadonlyArray<number> = [0.45, 0.25, 0.15, 1.0];

/** Colour preset for noon (12:00). Bright full white. */
export const COLOR_NOON: ReadonlyArray<number> = [1.0, 0.95, 0.85, 1.0];

/** Colour preset for dusk (18:00). Warm orange-red. */
export const COLOR_DUSK: ReadonlyArray<number> = [0.5, 0.2, 0.1, 1.0];

/**
 * Hour-indexed colour keyframes for diurnal cycle interpolation.
 *
 * Each entry defines the ambient colour at a specific game hour.
 * Interpolation is linear between adjacent keyframes.
 *
 * Keyframes are ordered by hour to support binary-search lookups.
 */
export const DIURNAL_KEYFRAMES = [
  { hour: 0, ambient: COLOR_MIDNIGHT, shadow: [0.0, 0.0, 0.02, 1.0] },
  { hour: 6, ambient: COLOR_DAWN, shadow: [0.05, 0.02, 0.05, 1.0] },
  { hour: 12, ambient: COLOR_NOON, shadow: [0.1, 0.08, 0.12, 1.0] },
  { hour: 18, ambient: COLOR_DUSK, shadow: [0.05, 0.02, 0.05, 1.0] },
  { hour: 24, ambient: COLOR_MIDNIGHT, shadow: [0.0, 0.0, 0.02, 1.0] },
] as const;

/**
 * Creates a zero-filled environment UBO backed by a Float32Array.
 *
 * The returned buffer is suitable for direct GPU upload.
 *
 * @returns A Float32Array of {@link ENVIRONMENT_UBO_SIZE} elements.
 */
export const createEnvironmentUBO = (): Float32Array => {
  return new Float32Array(ENVIRONMENT_UBO_SIZE);
};

/**
 * Copies the contents of a source environment UBO into a destination.
 *
 * @param src - Source buffer to copy from.
 * @param dst - Destination buffer to copy into (mutated in place).
 */
export const copyEnvironmentUBO = (src: Float32Array, dst: Float32Array): void => {
  dst.set(src);
};

/**
 * WGSL struct definition matching the UBO layout for shader compatibility.
 *
 * Copy this into any shader that consumes environment uniforms.
 */
export const ENVIRONMENT_SHADER_STRUCT = /* wgsl */ `
  struct EnvUniforms {
    uAmbientColor: vec4<f32>,
    uShadowColor: vec4<f32>,
    uAmbientIntensity: f32,
    uLocalTime: f32,
    uWindVelocity: f32,
    uRainIntensity: f32,
  };
`;
