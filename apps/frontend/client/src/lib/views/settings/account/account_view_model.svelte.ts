// apps/frontend/client/src/lib/views/settings/account/account_view_model.svelte.ts
//
// C-464 AC-1/2/7: Account settings section — identity, sync status,
// sign-out, and account deletion.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { authService, gameStateSyncService } from '$services';
import type { SaveSlotEntry } from '@aikami/types';

// ── Types ───────────────────────────────────────────────────────────────

export type AccountViewModelOptions = BaseViewModelOptions;

export type AccountViewModelInterface = BaseViewModelInterface & {
  /** Whether the user is signed in. */
  readonly isLoggedIn: boolean;
  /** The current user's display name. */
  readonly displayName: string | undefined;
  /** The current user's email. */
  readonly email: string | undefined;
  /** Whether the device is online. */
  readonly isOnline: boolean;
  /** Sync slots from the local database. */
  readonly syncSlots: SaveSlotEntry[];
  /** Whether sync data is loading. */
  readonly isSyncLoading: boolean;
  /** Whether a sign-out is in progress. */
  readonly isSigningOut: boolean;
  /** Whether the delete account confirmation dialog is open. */
  readonly isDeleteDialogOpen: boolean;
  /** The text typed into the delete confirmation field. */
  readonly deleteConfirmText: string;
  /** Whether the account deletion is in progress. */
  readonly isDeleting: boolean;
  /** Whether delete account should be shown (only on signed-out states). */
  readonly showDeleteAccount: boolean;

  /** Signs out the current user. */
  signOut(): Promise<void>;
  /** Opens the delete account confirmation dialog. */
  openDeleteDialog(): void;
  /** Closes the delete account confirmation dialog. */
  closeDeleteDialog(): void;
  /** Updates the delete confirmation text. */
  updateDeleteConfirmText(value: string): void;
  /** Confirms and executes account deletion. */
  confirmDeleteAccount(): Promise<void>;
  /** Refreshes the sync slots list. */
  refreshSyncSlots(): Promise<void>;
};

// ── Implementation ──────────────────────────────────────────────────────

class AccountViewModel
  extends BaseViewModel<AccountViewModelOptions>
  implements AccountViewModelInterface
{
  isSyncLoading = $state(false);
  isSigningOut = $state(false);
  isDeleteDialogOpen = $state(false);
  deleteConfirmText = $state('');
  isDeleting = $state(false);
  syncSlots = $state<SaveSlotEntry[]>([]);

  get isLoggedIn(): boolean {
    return authService.isLoggedIn;
  }

  get displayName(): string | undefined {
    return authService.currentUser?.displayName ?? authService.currentUser?.name;
  }

  get email(): string | undefined {
    return authService.currentUser?.email;
  }

  get isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  get showDeleteAccount(): boolean {
    return this.isLoggedIn;
  }

  override async initialize(): Promise<void> {
    if (this.isLoggedIn) {
      await this.refreshSyncSlots();
    }
    await super.initialize();
  }

  async signOut(): Promise<void> {
    this.isSigningOut = true;
    try {
      await authService.signOut();
      this.debug('signOut:success');
    } catch (error) {
      this.error('signOut', error);
    } finally {
      this.isSigningOut = false;
    }
  }

  async revokeAllSessions(): Promise<void> {
    this.isRevokingAllSessions = true;
    try {
      const { hubApiBase } = await import('$lib/services/api/hub_api_client');
      const base = hubApiBase();
      const response = await fetch(
        new URL('/api/account/sessions/revoke-all', base).href,
        { method: 'POST', credentials: 'include' },
      );
      if (!response.ok) {
        this.error('revokeAllSessions:failed', { status: response.status });
        return;
      }
      authService.setCurrentUser(undefined);
      this.debug('revokeAllSessions:success');
    } catch (error) {
      this.error('revokeAllSessions', error);
    } finally {
      this.isRevokingAllSessions = false;
    }
  }


  async refreshSyncSlots(): Promise<void> {
    if (!authService.uid) {
      return;
    }
    this.isSyncLoading = true;
    try {
      this.syncSlots = await gameStateSyncService.listSlots({ uid: authService.uid });
    } catch (error) {
      this.error('refreshSyncSlots', error);
    } finally {
      this.isSyncLoading = false;
    }
  }

  openDeleteDialog(): void {
    this.deleteConfirmText = '';
    this.isDeleteDialogOpen = true;
  }

  closeDeleteDialog(): void {
    this.isDeleteDialogOpen = false;
    this.deleteConfirmText = '';
  }

  updateDeleteConfirmText(value: string): void {
    this.deleteConfirmText = value;
  }

  async confirmDeleteAccount(): Promise<void> {
    if (this.deleteConfirmText !== 'DELETE') {
      return;
    }
    this.isDeleting = true;
    try {
      const success = await authService.deleteAccount();
      if (success) {
        this.closeDeleteDialog();
        this.debug('confirmDeleteAccount:success');
      } else {
        this.error('confirmDeleteAccount:failed');
      }
    } catch (error) {
      this.error('confirmDeleteAccount', error);
    } finally {
      this.isDeleting = false;
    }
  }
}

export const getAccountViewModel = (
  options: AccountViewModelOptions,
): AccountViewModelInterface => AccountViewModel.create(options);
