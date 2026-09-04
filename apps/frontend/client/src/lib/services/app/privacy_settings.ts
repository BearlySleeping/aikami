// apps/frontend/client/src/lib/services/app/privacy_settings.ts

/** Persisted AI privacy settings shared by settings and AI request boundaries. */
type AiPrivacySettings = {
  offlineMode: boolean;
  telemetryOptOut: boolean;
};

/** Stable storage key retained for existing installs. */
export const AI_PRIVACY_SETTINGS_STORAGE_KEY = 'aikami_ai_privacy_settings';

const DEFAULT_PRIVACY_SETTINGS: AiPrivacySettings = {
  offlineMode: false,
  telemetryOptOut: false,
};

/** Reads validated privacy settings, falling back safely when storage is unavailable. */
export const readAiPrivacySettings = (): AiPrivacySettings => {
  try {
    const stored = globalThis.localStorage?.getItem(AI_PRIVACY_SETTINGS_STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_PRIVACY_SETTINGS };
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_PRIVACY_SETTINGS };
    }
    const settings = parsed as Record<string, unknown>;
    return {
      offlineMode:
        typeof settings.offlineMode === 'boolean'
          ? settings.offlineMode
          : DEFAULT_PRIVACY_SETTINGS.offlineMode,
      telemetryOptOut:
        typeof settings.telemetryOptOut === 'boolean'
          ? settings.telemetryOptOut
          : DEFAULT_PRIVACY_SETTINGS.telemetryOptOut,
    };
  } catch {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
};

/** Persists the complete settings pair so toggles remain atomic. */
export const writeAiPrivacySettings = (settings: AiPrivacySettings): void => {
  try {
    globalThis.localStorage?.setItem(AI_PRIVACY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable.
  }
};

/** Returns whether prompt egress is currently disabled. */
export const isOfflineModeEnabled = (): boolean => readAiPrivacySettings().offlineMode;
