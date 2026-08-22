// apps/frontend/client/src/lib/views/link/link_view_model.svelte.ts
//
// ViewModel for /link — the device-link handoff page opened by the Tauri
// desktop app's system browser (see auth_service.svelte.ts's _betterAuthDeviceHandoff).
// Runs as a normal browser tab on a real domain, so Google sign-in works here
// even though it can't inside the Tauri webview. Once the user explicitly
// confirms, approves the device authorization via completeDeviceHandoff so the
// polling desktop client can exchange it for a session token — see
// auth_service.svelte.ts's _awaitBetterAuthDeviceApproval for the receiving side.
//
// Sign-in itself is handled by the shared LoginView (views/auth/login) —
// this VM only owns the link-specific handoff. When auth is ready and the
// user is signed in, the VM transitions to an explicit 'confirm' state; the
// handoff completes only when the user presses "Link this device"
// (confirmLink), never automatically. The `code` query param is mirrored to
// sessionStorage (with a timestamp) so it survives a full-page reload, and
// stale codes older than the desktop timeout window are rejected.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { authService } from '$services';

/** sessionStorage key mirroring the `code` query param across the redirect round-trip. */
const CODE_STORAGE_KEY = 'aikami-device-link-code';

/**
 * Max age for a persisted link code — matches DEVICE_LINK_TIMEOUT_MS in
 * auth_service.svelte.ts (the desktop app gives up waiting after this long).
 */
const CODE_TTL_MS = 5 * 60 * 1000;

export type LinkStatus = 'missing-code' | 'signed-out' | 'confirm' | 'linking' | 'linked' | 'error';

export type LinkViewModelInterface = BaseViewModelInterface & {
  readonly status: LinkStatus;
  readonly playerDisplayName: string | undefined;

  /** The active device-link code (for display/debug). */
  readonly code: string | undefined;

  /** `aikami://auth-callback?code=…` — manual fallback link for the linked state. */
  readonly handoffUrl: string | undefined;

  /** Explicit user action — completes the handoff ("Link this device"). */
  confirmLink(): void;
};

export type LinkViewModelOptions = BaseViewModelOptions;

class LinkViewModel extends BaseViewModel<LinkViewModelOptions> implements LinkViewModelInterface {
  status = $state<LinkStatus>('signed-out');

  private _code: string | undefined;

  /** Guards the handoff so it only runs once per session (or per retry). */
  private _linkStarted = false;

  get playerDisplayName(): string | undefined {
    return authService.currentUser?.displayName || authService.currentUser?.email || undefined;
  }

  get code(): string | undefined {
    return this._code;
  }

  get handoffUrl(): string | undefined {
    // URL-encode so codes containing &, #, ? survive the deep-link round trip
    // and urlMatchesCode (which decodes via URLSearchParams) can match them.
    return this._code ? `aikami://auth-callback?code=${encodeURIComponent(this._code)}` : undefined;
  }

  override async initialize(): Promise<void> {
    // Ensure the persisted session is resolved before the reactive handoff
    // trigger reads auth state (initialize() is idempotent and, since the
    // init-promise fix in auth_service, awaits the SAME in-flight init when
    // AppViewModel already started it).
    await authService.initialize();

    const urlCode = page.url.searchParams.get('code') ?? undefined;

    // Mirror the code (with timestamp) to sessionStorage so it survives a
    // full-page reload (Firebase's return URL is not guaranteed to keep the
    // query), and validate its age when restored from storage.
    if (urlCode) {
      this._writeStoredCode(urlCode);
    }
    this._code = urlCode ?? this._readStoredCode();

    if (!this._code) {
      this.status = 'missing-code';
      this._showLoadingView = false;
      await super.initialize();
      return;
    }

    // If the user is already signed in, transition to the confirmation state
    // NOW (deterministically) so the loading view never flashes the sign-in
    // button — the $effect below stays as the reactive path for sign-ins
    // that happen while the page is open.
    if (authService.isLoggedIn) {
      this.status = 'confirm';
    }

    // When auth is ready and the user is signed in, transition to an explicit
    // confirmation state — never auto-complete the handoff. The user must
    // press "Link this device" (confirmLink), so no page on this origin can
    // hand the token to a device without consent.
    this.registerEffectRoot(() => {
      $effect(() => {
        const ready = authService.isAuthReady;
        const loggedIn = authService.isLoggedIn;
        if (!ready || !loggedIn || this._linkStarted) {
          return;
        }
        this.status = 'confirm';
      });
    });

    // Auth is resolved and the initial status is known — reveal the page
    // (startWithLoadingView keeps the loading view up until this point).
    this._showLoadingView = false;

    await super.initialize();
  }

  /** Explicit user confirmation — completes the device link. */
  confirmLink(): void {
    if (this._linkStarted) {
      return;
    }
    this._linkStarted = true;
    void this._completeLink();
  }

  private _readStoredCode(): string | undefined {
    try {
      const raw = sessionStorage.getItem(CODE_STORAGE_KEY);
      if (!raw) {
        return undefined;
      }
      const stored = JSON.parse(raw) as { code?: string; ts?: number } | null;
      if (!stored?.code) {
        return undefined;
      }
      // Reject stale codes — older than the desktop app's timeout window.
      if (!stored.ts || Date.now() - stored.ts > CODE_TTL_MS) {
        this.debug('initialize:stale-code-discarded');
        sessionStorage.removeItem(CODE_STORAGE_KEY);
        return undefined;
      }
      return stored.code;
    } catch (error) {
      this.debug('initialize:sessionStorage-read-failed', { error: String(error) });
      return undefined;
    }
  }

  private _writeStoredCode(code: string): void {
    try {
      sessionStorage.setItem(CODE_STORAGE_KEY, JSON.stringify({ code, ts: Date.now() }));
    } catch (error) {
      this.debug('initialize:sessionStorage-write-failed', { error: String(error) });
    }
  }

  private async _completeLink(): Promise<void> {
    if (!this._code || !authService.uid) {
      return;
    }

    this.status = 'linking';
    try {
      await authService.completeDeviceHandoff({ code: this._code, uid: authService.uid });

      // Paint the success state BEFORE the best-effort deep-link navigation —
      // assigning an unregistered `aikami://` scheme can blank the tab, and
      // the desktop app's poll loop is the guaranteed fallback either way.
      this.status = 'linked';
      try {
        sessionStorage.removeItem(CODE_STORAGE_KEY);
      } catch (error) {
        this.debug('_completeLink:sessionStorage-clear-failed', { error: String(error) });
      }
      this._tryDeepLinkRedirect(this._code);
    } catch (error) {
      this.status = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Failed to link device';
      // Allow retrying without a reload: drop the persisted code and reset
      // the guard so "Link this device" works again.
      try {
        sessionStorage.removeItem(CODE_STORAGE_KEY);
      } catch (clearError) {
        this.debug('_completeLink:sessionStorage-clear-failed', { error: String(clearError) });
      }
      this._linkStarted = false;
      this.debug('_completeLink:error', { error: String(error) });
    }
  }

  /**
   * Best-effort instant handoff — most OSes will route this to the desktop
   * app if it registered the `aikami://` scheme (see src-tauri's deep-link
   * plugin config). If nothing handles it, this silently does nothing; the
   * desktop app's poll loop is the guaranteed fallback either way.
   */
  private _tryDeepLinkRedirect(code: string): void {
    try {
      window.location.href = `aikami://auth-callback?code=${encodeURIComponent(code)}`;
    } catch (error) {
      this.debug('_tryDeepLinkRedirect:error', { error: String(error) });
    }
  }
}

export const getLinkViewModel = (options: LinkViewModelOptions): LinkViewModelInterface =>
  LinkViewModel.create(options);
