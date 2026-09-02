// apps/frontend/client/src/lib/services/auth/desktop_session_store.ts
//
// Persistent session token for the Tauri desktop client.
//
// The desktop app cannot hold a Better Auth session in a cookie. Its webview
// origin is `tauri://localhost`, so every request to hub.bearlysleeping.com is
// cross-SITE: the hub's session cookie (SameSite=Lax, domain
// bearlysleeping.com) is never sent, and `document.cookie` in the webview can
// only write cookies for its own origin — never for the hub's. The device
// -authorization flow therefore hands back a session token
// (`access_token`, token_type Bearer) which this module persists and which
// better_auth_client.ts replays as an `Authorization: Bearer` header. The hub
// resolves it through Better Auth's bearer plugin.
//
// Stored as JSON next to the runtime config in `appDataDir()`, not in
// localStorage: web content in the webview cannot read it, and it survives
// restarts so the user does not repeat the browser handoff on every launch.
//
// No-ops outside Tauri. Browser clients keep using the session cookie, so
// nothing here ever runs for them.

import { logger } from '@aikami/logger';
import { isTauri } from '$lib/views/utils/is_tauri';

/** File name under appDataDir(). */
const SESSION_FILE = 'session.json';

type StoredSession = {
  token: string;
  /** Epoch ms. Absent for tokens stored before an expiry was known. */
  expiresAt?: number;
};

/**
 * In-memory mirror of the stored token. Header construction is synchronous, so
 * the disk read happens once via `loadDesktopSessionToken()` at auth init and
 * every later read is served from here.
 */
let cachedToken: string | undefined;
let loaded = false;

/** The subset of @tauri-apps/plugin-fs this module uses. */
type TauriFsModule = {
  exists: (path: string) => Promise<boolean>;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, contents: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

const sessionFilePath = async (): Promise<{ fs: TauriFsModule; path: string } | undefined> => {
  if (!isTauri()) {
    return undefined;
  }
  try {
    // Platform-specific code — dynamic import is justified here (matches
    // tauri_fs_cache_backend.ts).
    const [{ appDataDir, join }, fs] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    return {
      fs: fs as unknown as TauriFsModule, // guard-ignore lint/type-safety/casting: Tauri fs API types not available in browser; runtime type guaranteed by Tauri plugin
      path: await join(await appDataDir(), SESSION_FILE),
    };
  } catch (error) {
    logger.warn('desktopSession:unavailable', { error: String(error) });
    return undefined;
  }
};

/**
 * Read the stored token into memory. Safe to call repeatedly — the disk read
 * happens once. Returns the token, or undefined when there is none, it expired,
 * or we are not running under Tauri.
 */
export const loadDesktopSessionToken = async (): Promise<string | undefined> => {
  if (loaded) {
    return cachedToken;
  }
  loaded = true;

  const target = await sessionFilePath();
  if (!target) {
    return undefined;
  }
  try {
    if (!(await target.fs.exists(target.path))) {
      return undefined;
    }
    const stored = JSON.parse(await target.fs.readTextFile(target.path)) as StoredSession;
    if (!stored?.token) {
      return undefined;
    }
    // Drop an expired token rather than sending one the hub will reject —
    // otherwise the app looks signed in until the first request fails.
    if (stored.expiresAt && stored.expiresAt <= Date.now()) {
      logger.debug('desktopSession:expired');
      await clearDesktopSessionToken();
      return undefined;
    }
    cachedToken = stored.token;
    logger.debug('desktopSession:loaded');
    return cachedToken;
  } catch (error) {
    logger.warn('desktopSession:read-failed', { error: String(error) });
    return undefined;
  }
};

/**
 * Persist the session token handed back by the device-authorization exchange.
 *
 * @param options.token Better Auth session token (the `access_token` field).
 * @param options.expiresInSeconds Lifetime from the same response, when known.
 */
export const saveDesktopSessionToken = async (options: {
  token: string;
  expiresInSeconds?: number;
}): Promise<void> => {
  // Cache first: the token must work for the immediately-following
  // get-session call even if writing to disk fails.
  cachedToken = options.token;
  loaded = true;

  const target = await sessionFilePath();
  if (!target) {
    return;
  }
  const stored: StoredSession = {
    token: options.token,
    ...(options.expiresInSeconds
      ? { expiresAt: Date.now() + options.expiresInSeconds * 1000 }
      : {}),
  };
  try {
    await target.fs.writeTextFile(target.path, JSON.stringify(stored));
    logger.debug('desktopSession:saved');
  } catch (error) {
    logger.warn('desktopSession:write-failed', { error: String(error) });
  }
};

/** Forget the stored token (sign-out, or an expired/rejected token). */
export const clearDesktopSessionToken = async (): Promise<void> => {
  cachedToken = undefined;
  loaded = true;

  const target = await sessionFilePath();
  if (!target) {
    return;
  }
  try {
    if (await target.fs.exists(target.path)) {
      await target.fs.remove(target.path);
    }
  } catch (error) {
    logger.warn('desktopSession:clear-failed', { error: String(error) });
  }
};

/**
 * The in-memory token, for building request headers synchronously.
 * Returns undefined until `loadDesktopSessionToken()` has run.
 */
export const getDesktopSessionToken = (): string | undefined => cachedToken;

/** Test seam — resets module state between cases. */
export const resetDesktopSessionForTests = (): void => {
  cachedToken = undefined;
  loaded = false;
};
