// apps/frontend/client/src/lib/views/link/link_view_model.svelte.ts
//
// ViewModel for /link — the device-link handoff page opened by the Tauri
// desktop app's system browser (see auth_service.svelte.ts's
// _linkDeviceSignIn). Runs as a normal browser tab on a real, Firebase-
// authorized domain, so signInWithPopup works here even though it can't
// inside the Tauri webview. Once signed in, hands a custom token back to
// the desktop app via completeDeviceHandoff (existing endpoint) — see
// auth_service.svelte.ts's _awaitDeviceHandoffToken for the receiving side.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { authService } from '$services';

export type LinkStatus = 'missing-code' | 'signed-out' | 'signing-in' | 'linking' | 'linked' | 'error';

export type LinkViewModelInterface = BaseViewModelInterface & {
  readonly status: LinkStatus;
  readonly playerDisplayName: string | undefined;

  signInWithGoogle(): Promise<void>;
};

export type LinkViewModelOptions = BaseViewModelOptions;

class LinkViewModel extends BaseViewModel<LinkViewModelOptions> implements LinkViewModelInterface {
  status = $state<LinkStatus>('signed-out');

  private _code: string | undefined;

  get playerDisplayName(): string | undefined {
    return authService.currentUser?.displayName || authService.currentUser?.email || undefined;
  }

  override async initialize(): Promise<void> {
    this._code = page.url.searchParams.get('code') ?? undefined;

    if (!this._code) {
      this.status = 'missing-code';
      await super.initialize();
      return;
    }

    if (authService.isLoggedIn) {
      await this._completeLink();
    }

    await super.initialize();
  }

  async signInWithGoogle(): Promise<void> {
    if (!this._code || this.status === 'signing-in' || this.status === 'linking') {
      return;
    }

    this.status = 'signing-in';
    this.errorMessage = undefined;

    try {
      const response = await authService.socialSignIn('google');
      if (response.status === 'failed') {
        this.status = 'error';
        this.errorMessage = response.payload.message || response.payload.code || 'Sign-in failed';
        return;
      }
      await this._completeLink();
    } catch (error) {
      this.status = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Sign-in failed';
      this.debug('signInWithGoogle:error', { error: String(error) });
    }
  }

  private async _completeLink(): Promise<void> {
    if (!this._code || !authService.uid) {
      return;
    }

    this.status = 'linking';
    try {
      await authService.completeDeviceHandoff({ code: this._code, uid: authService.uid });
      this._tryDeepLinkRedirect(this._code);
      this.status = 'linked';
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
