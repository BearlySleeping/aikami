// apps/frontend/client/src/lib/views/link/link_view_model.svelte.ts
//
// ViewModel for /link — the device-link handoff page opened by the Tauri
// desktop app's system browser (see auth_service.svelte.ts's
// _linkDeviceSignIn). Runs as a normal browser tab on a real, Firebase-
// authorized domain, so Google sign-in works here even though it can't
// inside the Tauri webview. Once signed in, hands a custom token back to
// the desktop app via completeDeviceHandoff (existing endpoint) — see
// auth_service.svelte.ts's _awaitDeviceHandoffToken for the receiving side.
//
// Sign-in itself is handled by the shared LoginView (views/auth/login) —
// this VM only owns the link-specific handoff. It reacts to authService
// state rather than button clicks: the trigger for completing the handoff
// is "auth became ready + logged in", not "button was clicked". That holds
// for every path — popup sign-in resolving in-page, a session restored on
// load, or (defensively) a redirect round-trip. The `code` query param is
// mirrored to sessionStorage so it survives a full-page reload even if the
// return URL is normalized.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { untrack } from 'svelte';
import { page } from '$app/state';
import { authService } from '$services';

/** sessionStorage key mirroring the `code` query param across the redirect round-trip. */
const CODE_STORAGE_KEY = 'aikami-device-link-code';

export type LinkStatus = 'missing-code' | 'signed-out' | 'linking' | 'linked' | 'error';

export type LinkViewModelInterface = BaseViewModelInterface & {
  readonly status: LinkStatus;
  readonly playerDisplayName: string | undefined;

  /** `aikami://auth-callback?code=…` — manual fallback link for the linked state. */
  readonly handoffUrl: string | undefined;
};

export type LinkViewModelOptions = BaseViewModelOptions;

class LinkViewModel extends BaseViewModel<LinkViewModelOptions> implements LinkViewModelInterface {
  status = $state<LinkStatus>('signed-out');

  private _code: string | undefined;

  /** Guards the reactive handoff trigger so it only fires once per session. */
  private _linkStarted = false;

  get playerDisplayName(): string | undefined {
    return authService.currentUser?.displayName || authService.currentUser?.email || undefined;
  }

  get handoffUrl(): string | undefined {
    return this._code ? `aikami://auth-callback?code=${this._code}` : undefined;
  }

  override async initialize(): Promise<void> {
    // Ensure the persisted session is resolved before the reactive handoff
    // trigger reads auth state (initialize() is idempotent and, since the
    // init-promise fix in auth_service, awaits the SAME in-flight init when
    // AppViewModel already started it).
    await authService.initialize();

    const urlCode = page.url.searchParams.get('code') ?? undefined;

    // Mirror the code to sessionStorage so it survives a full-page reload
    // (Firebase's return URL is not guaranteed to keep the query).
    if (urlCode) {
      try {
        sessionStorage.setItem(CODE_STORAGE_KEY, urlCode);
      } catch (error) {
        this.debug('initialize:sessionStorage-write-failed', { error: String(error) });
      }
    }
    this._code = urlCode ?? this._readStoredCode();

    if (!this._code) {
      this.status = 'missing-code';
      await super.initialize();
      return;
    }

    // Reactive handoff trigger — covers every sign-in path:
    //   • user lands already signed in,
    //   • popup sign-in resolving in-place (this effect — not the click —
    //     is what completes the handoff),
    //   • a session restored on a reload after sign-in (defensive).
    this.registerEffectRoot(() => {
      $effect(() => {
        const ready = authService.isAuthReady;
        const loggedIn = authService.isLoggedIn;
        if (!ready || !loggedIn || this._linkStarted) {
          return;
        }
        this._linkStarted = true;
        untrack(() => {
          void this._completeLink();
        });
      });
    });

    await super.initialize();
  }

  private _readStoredCode(): string | undefined {
    try {
      return sessionStorage.getItem(CODE_STORAGE_KEY) ?? undefined;
    } catch (error) {
      this.debug('initialize:sessionStorage-read-failed', { error: String(error) });
      return undefined;
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
      window.location.href = `aikami://auth-callback?code=${code}`;
    } catch (error) {
      this.debug('_tryDeepLinkRedirect:error', { error: String(error) });
    }
  }
}

export const getLinkViewModel = (options: LinkViewModelOptions): LinkViewModelInterface =>
  LinkViewModel.create(options);
