// packages/frontend/engine/src/systems/environment_system.ts
// ---------------------------------------------------------------------------
// EnvironmentSystem — time-of-day simulation, diurnal colour interpolation,
// and weather parameter management.
//
// Contract C-213: Environment, Time, and Weather Core System
//
// This system runs every tick in the ECS worker and updates the global
// environment UBO. It does not interact with ECS components — it is a
// pure time-driven simulation layer.
//
// Game time scaling: by default, 1 real second = 1 game minute, giving a
// full diurnal cycle in 24 real minutes. The scale is configurable.
// ---------------------------------------------------------------------------

import {
  COLOR_MIDNIGHT,
  createEnvironmentUBO,
  DIURNAL_KEYFRAMES,
  ENV_UBO_OFFSETS,
} from '../environment/environment_ubo.ts';

// ---------------------------------------------------------------------------
// Private module-level state
// ---------------------------------------------------------------------------

/** Accumulated game time in seconds. */
let _gameTimeSeconds = 0;

/** The Float32Array backing the environment UBO. */
let _environmentUBO = createEnvironmentUBO();

/** Whether the system has been initialised with a first tick. */
let _initialised = false;

/** Current game hour (0–24). Derived from _gameTimeSeconds. */
let _gameHour = 12;

/** Current game minute (0–59). Derived from _gameTimeSeconds. */
let _gameMinute = 0;

/** Wind velocity scalar (−1.0 to 1.0, sign = direction, magnitude = speed). */
let _windVelocity = 0.0;

/** Rain intensity (0.0 = clear, 1.0 = full storm). */
let _rainIntensity = 0.0;

/** Time scale factor: game seconds per real second. Default 60 (1 real sec = 1 game min). */
let _timeScale = 60;

// ---------------------------------------------------------------------------
// Reset helpers (used by tests)
// ---------------------------------------------------------------------------

/**
 * Resets the environment system state to defaults.
 *
 * This is exposed for test fixtures — production code should never need
 * to call this directly.
 */
export const resetEnvironmentTracking = (): void => {
  _gameTimeSeconds = 0;
  _environmentUBO = createEnvironmentUBO();
  _initialised = false;
  _gameHour = 12;
  _gameMinute = 0;
  _windVelocity = 0.0;
  _rainIntensity = 0.0;
  _timeScale = 60;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options for {@link setEnvironmentConfig}. */
export type SetEnvironmentConfigOptions = {
  /** Time scale: game seconds per real second. Default 60. */
  timeScale?: number;
  /** Wind velocity (−1.0 to 1.0). */
  windVelocity?: number;
  /** Rain intensity (0.0 to 1.0). */
  rainIntensity?: number;
  /** Starting game hour (0–24). */
  startHour?: number;
};

/**
 * Applies runtime configuration to the environment system.
 *
 * Use this to set weather parameters from dev sliders or game events.
 *
 * @param options - Configuration values to apply.
 */
export const setEnvironmentConfig = (options: SetEnvironmentConfigOptions): void => {
  if (options.timeScale !== undefined) {
    _timeScale = Math.max(1, options.timeScale);
  }

  if (options.windVelocity !== undefined) {
    _windVelocity = Math.max(-1.0, Math.min(1.0, options.windVelocity));
  }

  if (options.rainIntensity !== undefined) {
    _rainIntensity = Math.max(0.0, Math.min(1.0, options.rainIntensity));
  }

  if (options.startHour !== undefined) {
    _gameHour = options.startHour % 24;
    _gameTimeSeconds = _gameHour * 3600; // Convert hours to game seconds
    // Reinitialise the last tick so the first frame computes properly
    _initialised = false;
  }
};

// ---------------------------------------------------------------------------
// Colour interpolation
// ---------------------------------------------------------------------------

/**
 * Linearly interpolates between two RGBA colour arrays.
 *
 * @param a - Start colour [r, g, b, a].
 * @param b - End colour [r, g, b, a].
 * @param t - Interpolation factor (0.0 = a, 1.0 = b).
 * @returns Interpolated colour as a new [r, g, b, a] array.
 */
const _lerpColor = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  t: number,
): Array<number> => {
  const clampedT = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clampedT,
    a[1] + (b[1] - a[1]) * clampedT,
    a[2] + (b[2] - a[2]) * clampedT,
    a[3] + (b[3] - a[3]) * clampedT,
  ];
};

/**
 * Finds the two keyframes that bracket the given hour and returns the
 * interpolation factor.
 *
 * @param hour - Game hour (0–24).
 * @returns The interpolated ambient colour, shadow colour, and the
 *          ambient intensity factor.
 */
const _interpolateDiurnal = (
  hour: number,
): {
  ambient: Array<number>;
  shadow: Array<number>;
  intensity: number;
} => {
  const clamped = hour % 24;

  // Find bracketing keyframes
  const keyframes = DIURNAL_KEYFRAMES;
  let lower: (typeof keyframes)[number] = keyframes[0] ?? { hour: 0, ambient: COLOR_MIDNIGHT, shadow: [0, 0, 0.02, 1] };
  let upper: (typeof keyframes)[number] = keyframes[keyframes.length - 1] ?? { hour: 24, ambient: COLOR_MIDNIGHT, shadow: [0, 0, 0.02, 1] };

  for (let i = 0; i < keyframes.length - 1; i++) {
    const current = keyframes[i];
    const next = keyframes[i + 1];
    if (current && next && clamped >= current.hour && clamped <= next.hour) {
      lower = current;
      upper = next;
      break;
    }
  }

  // Compute interpolation factor
  const span = upper.hour - lower.hour;
  const t = span > 0 ? (clamped - lower.hour) / span : 0;

  const ambient = _lerpColor(lower.ambient, upper.ambient, t);
  const shadow = _lerpColor(lower.shadow, upper.shadow, t);

  // Ambient intensity: peaks at noon, lowest at midnight
  // Use a cosine wave: 1.0 at noon (12), 0.0 at midnight (0/24)
  const phase = (((clamped + 12) % 24) / 12) * Math.PI;
  const intensity = (Math.cos(phase) + 1) / 2; // Maps to [0, 1]

  return { ambient, shadow, intensity };
};

// ---------------------------------------------------------------------------
// Weather generation (procedural wind drift)
// ---------------------------------------------------------------------------

/**
 * Updates wind velocity with procedural drift.
 *
 * Applies a small random perturbation each tick, clamped to [-1, 1].
 *
 * @param deltaMs - Delta time in milliseconds.
 */
const _updateWindDrift = (deltaMs: number): void => {
  // Drift by a small random amount (scaled by delta time)
  const drift = (Math.random() - 0.5) * 0.001 * (deltaMs / 16);
  _windVelocity = Math.max(-1.0, Math.min(1.0, _windVelocity + drift));
};

/**
 * Updates rain intensity with smooth decay toward a target value.
 *
 * @param _deltaMs - Delta time in milliseconds (unused currently).
 */
const _updateRainDecay = (_deltaMs: number): void => {
  // Rain decays slowly toward 0 unless explicitly set via setEnvironmentConfig
  // This provides a natural weather cycle feel when not actively controlled
  const decayRate = 0.00005;
  if (_rainIntensity > 0) {
    _rainIntensity = Math.max(0, _rainIntensity - decayRate);
  }
};

// ---------------------------------------------------------------------------
// UBO population
// ---------------------------------------------------------------------------

/**
 * Writes the current environment state into the UBO Float32Array.
 *
 * Called once per tick after all computations complete.
 */
const _flushUBO = (): void => {
  // Compute diurnal colours for the current hour (including sub-hour interpolation)
  const fraction = _gameMinute / 60;
  const hourFloat = _gameHour + fraction;
  const { ambient, shadow, intensity } = _interpolateDiurnal(hourFloat);

  _environmentUBO[ENV_UBO_OFFSETS.ambientColor + 0] = ambient[0] ?? 0;
  _environmentUBO[ENV_UBO_OFFSETS.ambientColor + 1] = ambient[1] ?? 0;
  _environmentUBO[ENV_UBO_OFFSETS.ambientColor + 2] = ambient[2] ?? 0;
  _environmentUBO[ENV_UBO_OFFSETS.ambientColor + 3] = ambient[3] ?? 0;

  _environmentUBO[ENV_UBO_OFFSETS.shadowColor + 0] = shadow[0] ?? 0;
  _environmentUBO[ENV_UBO_OFFSETS.shadowColor + 1] = shadow[1] ?? 0;
  _environmentUBO[ENV_UBO_OFFSETS.shadowColor + 2] = shadow[2] ?? 0;
  _environmentUBO[ENV_UBO_OFFSETS.shadowColor + 3] = shadow[3] ?? 0;

  _environmentUBO[ENV_UBO_OFFSETS.ambientIntensity] = intensity;
  _environmentUBO[ENV_UBO_OFFSETS.localTime] = _gameTimeSeconds;
  _environmentUBO[ENV_UBO_OFFSETS.windVelocity] = _windVelocity;
  _environmentUBO[ENV_UBO_OFFSETS.rainIntensity] = _rainIntensity;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Environment state snapshot consumed by the main thread for HUD display
 * and rendering.
 */
export type EnvironmentState = {
  /** Game hour (0–24). */
  gameHour: number;
  /** Game minute (0–59). */
  gameMinute: number;
  /** Game time in seconds since epoch. */
  gameTimeSeconds: number;
  /** Wind velocity (−1.0 to 1.0). */
  windVelocity: number;
  /** Rain intensity (0.0 to 1.0). */
  rainIntensity: number;
  /** The Float32Array backing the environment UBO (48 bytes, 12 floats). */
  ubo: Float32Array;
};

/**
 * Steps the environment simulation by one tick.
 *
 * Advances game time, interpolates diurnal colours, updates weather,
 * and flushes the environment UBO. Called once per tick from the ECS worker.
 *
 * @param options - Tick options.
 * @param options.deltaMs - Delta time in milliseconds since the last tick.
 * @returns The current environment state snapshot for STATE_UPDATE messages.
 */
export const stepEnvironment = (options: { deltaMs: number }): EnvironmentState => {
  const { deltaMs } = options;

  // Initialise the first tick timestamp
  if (!_initialised) {
    _initialised = true;
  }

  // Compute game time delta (real ms → game seconds via time scale)
  const gameDeltaSeconds = (deltaMs / 1000) * _timeScale;
  _gameTimeSeconds += gameDeltaSeconds;

  // Derive game hour and minute
  const totalGameMinutes = _gameTimeSeconds / 60;
  _gameHour = Math.floor(totalGameMinutes / 60) % 24;
  _gameMinute = Math.floor(totalGameMinutes % 60);

  // Update weather with procedural drift
  _updateWindDrift(deltaMs);
  _updateRainDecay(deltaMs);

  // Flush computed values into the UBO Float32Array
  _flushUBO();

  return {
    gameHour: _gameHour,
    gameMinute: _gameMinute,
    gameTimeSeconds: _gameTimeSeconds,
    windVelocity: _windVelocity,
    rainIntensity: _rainIntensity,
    ubo: _environmentUBO,
  };
};

/**
 * Returns a read-only snapshot of the current environment state without
 * advancing the simulation.
 *
 * @returns The current environment state.
 */
export const getEnvironmentState = (): EnvironmentState => {
  return {
    gameHour: _gameHour,
    gameMinute: _gameMinute,
    gameTimeSeconds: _gameTimeSeconds,
    windVelocity: _windVelocity,
    rainIntensity: _rainIntensity,
    ubo: _environmentUBO,
  };
};
