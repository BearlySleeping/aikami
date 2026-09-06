// packages/shared/local-ai/src/lib/host_detect.ts
//
// Host detection utility — decides at the action boundary whether native
// (Tauri desktop) actions are available. A browser must never be offered a
// native install or probe action, and must never be equated with cloud-only.

/**
 * Checks whether the code is running in a Tauri desktop webview.
 * Detects the Tauri global (`__TAURI_INTERNALS__`) which is injected
 * by the Tauri runtime and never present in a plain browser.
 */
export const isTauriHost = (): boolean => '__TAURI_INTERNALS__' in globalThis;

/**
 * Checks whether the code is running in a plain browser (not Tauri).
 * In environments without a DOM (Node, Bun), this returns false.
 */
export const isBrowserHost = (): boolean => 'window' in globalThis && !isTauriHost();

/**
 * Checks whether the runtime is a Tauri host AND supports the given
 * native capability. Use this at action boundaries to guard native
 * operations.
 */
export const hasNativeCapability = (capability: 'shell' | 'filesystem' | 'download'): boolean => {
  if (!isTauriHost()) {
    return false;
  }
  // Capabilities are verified by the Tauri allowlist. The presence of
  // __TAURI_INTERNALS__ implies basic IPC is available; specific
  // capabilities depend on the app's Tauri capabilities configuration.
  switch (capability) {
    case 'shell':
    case 'filesystem':
    case 'download':
      return true;
    default:
      return false;
  }
};
