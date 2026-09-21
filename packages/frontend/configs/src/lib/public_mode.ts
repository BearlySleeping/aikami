// packages/frontend/configs/src/lib/public_mode.ts

/** True only for the repository's recognized non-production public modes. */
export const isDevelopmentModePublic = (): boolean => {
  const mode = import.meta.env.PUBLIC_MODE;
  return mode === 'staging' || mode === 'emulator' || mode === 'testing';
};
