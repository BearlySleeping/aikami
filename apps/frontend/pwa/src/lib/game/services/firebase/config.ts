// apps/frontend/pwa/src/lib/game/services/firebase/config.ts
/**
 * Firebase configuration for the game client.
 * Resolves endpoints based on environment (emulator vs production).
 * Uses environment variables injected at build time via Vite.
 */
import { EMULATOR_PORTS } from '@aikami/constants';
import {
  getProjectId,
  isEmulatorModePublic,
  publicEnv,
} from '@aikami/frontend/configs/environment';

/**
 * Firebase config for the lightweight game client.
 */
export type FirebaseConfig = {
  apiKey: string;
  projectId: string;
  authEndpoint: string;
  firestoreEndpoint: string;
  storageEndpoint: string;
  functionsEndpoint: string;
  isEmulator: boolean;
};

/**
 * Resolves Firebase config at runtime.
 * Reads environment variables set by Vite (import.meta.env) for emulator detection.
 */
export const resolveConfig = (): FirebaseConfig => {
  // Check if running against emulator (set by Vite env or detected from host)
  const isEmulator = isEmulatorModePublic();
  const projectId = getProjectId();

  const apiKey = isEmulator ? 'fake-api-key' : publicEnv.PUBLIC_FIREBASE_API_KEY;

  const base = isEmulator ? 'http://127.0.0.1' : '';

  return {
    apiKey,
    projectId,
    authEndpoint: isEmulator
      ? `http://127.0.0.1:${EMULATOR_PORTS.auth}/identitytoolkit.googleapis.com/v1`
      : `https://identitytoolkit.googleapis.com/v1/projects/${projectId}`,
    firestoreEndpoint: isEmulator
      ? `${base}:${EMULATOR_PORTS.firestore}/v1/projects/${projectId}/databases/(default)/documents`
      : `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`,
    storageEndpoint: isEmulator
      ? `${base}:${EMULATOR_PORTS.storage}/v0/b/${projectId}.appspot.com/o`
      : `https://storage.googleapis.com/storage/v1/b/${projectId}.appspot.com/o`,
    functionsEndpoint: isEmulator
      ? `${base}:${EMULATOR_PORTS.functions}/${projectId}/europe-west1`
      : `https://europe-west1-${projectId}.cloudfunctions.net`,
    isEmulator,
  };
};

/**
 * Singleton config instance — resolved once at first access.
 */
let _config: FirebaseConfig | undefined;

export const getConfig = (): FirebaseConfig => {
  if (!_config) {
    _config = resolveConfig();
  }
  return _config;
};
