// packages/frontend/engine/src/environment/index.ts
// ---------------------------------------------------------------------------
// Environment package — barrel exports
// ---------------------------------------------------------------------------

export {
  ambientToHex,
  applyAmbientToEntity,
  NEUTRAL_SCENE_AMBIENT,
  resolveSceneAmbient,
  type SceneAmbient,
} from './ambient_policy.ts';
export {
  COLOR_DAWN,
  COLOR_DUSK,
  COLOR_MIDNIGHT,
  COLOR_NOON,
  copyEnvironmentUBO,
  createEnvironmentUBO,
  DIURNAL_KEYFRAMES,
  ENV_UBO_OFFSETS,
  ENVIRONMENT_SHADER_STRUCT,
  ENVIRONMENT_UBO_BYTES,
  ENVIRONMENT_UBO_SIZE,
} from './environment_ubo.ts';
