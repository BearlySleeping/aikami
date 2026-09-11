// apps/frontend/client/src/lib/views/settings/account/account_view_model.svelte.ts
//
// C-464 AC-1/2/7: Account settings section — identity, sync status,
// sign-out, and account deletion.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/account_fixtures.ts) instead of
// mocking the global service registry. Production wiring lives in
// ./account_composition.ts.

import type { BackupEntry } from '@aikami/frontend/services/backup_client';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The identity fields the account view displays. */
export type AccountUser = {
  readonly displayName?: string;
  readonly email?: string;
};

/** The account/identity operations the account view performs. */
export type AccountCapabilities = {
  readonly isLoggedIn: boolean;
  readonly currentUser: AccountUser | undefined;
  readonly uid: string | undefined;
  signOut(): Promise<boolean>;
  deleteAccount(): Promise<boolean>;
  revokeAllSessions(): Promise<boolean>;
};

/** The cloud-backup capability the account view reads. */
export type AccountBackupCapabilities = {
  listBackups(): Promise<BackupEntry[]>;
};

// ── Types ───────────────────────────────────────────────────────────────

export type AccountViewModelOptions = BaseViewModelOptions & {
  /** Account/identity operations. */
  account: AccountCapabilities;
  /** Cloud backup listing. */
  backups: AccountBackupCapabilities;
  /** Platform online probe. Defaults to `navigator.onLine` when omitted. */
  isOnline?: () => boolean;
};

export type AccountViewModelInterface = BaseViewModelInterface & {
  /** Whether the user is signed in. */
  readonly isLoggedIn: boolean;
  /** The current user's display name. */
  readonly displayName: string | undefined;
  /** The current user's email. */
  readonly email: string | undefined;
  /** Whether the device is online. */
  readonly isOnline: boolean;
  /** Backups available for the signed-in user. */
  readonly backups: BackupEntry[];
  /** Whether backups are loading. */
  readonly isBackupsLoading: boolean;
  /** Whether a sign-out is in progress. */
  readonly isSigningOut: boolean;
  /** Whether all account sessions are being revoked. */
  readonly isRevokingAllSessions: boolean;
  /** Whether the delete account confirmation dialog is open. */
  readonly isDeleteDialogOpen: boolean;
  /** The text typed into the delete confirmation field. */
  readonly deleteConfirmText: string;
  /** Whether the account deletion is in progress. */
  readonly isDeleting: boolean;
  /** Whether delete account should be shown (only on signed-out states). */
  readonly showDeleteAccount: boolean;

  /** Signs out the current user. Resolves true when the sign-out succeeded. */
  signOut(): Promise<boolean>;
  /** Revokes all sessions for the current account. */
  revokeAllSessions(): Promise<void>;
  /** Opens the delete account confirmation dialog. */
  openDeleteDialog(): void;
  /** Closes the delete account confirmation dialog. */
  closeDeleteDialog(): void;
  /** Updates the delete confirmation text. */
  updateDeleteConfirmText(value: string): void;
  /** Confirms and executes account deletion. */
  confirmDeleteAccount(): Promise<void>;
  /** Refreshes the cloud backups list. */
  refreshBackups(): Promise<void>;
};

// ── Implementation ──────────────────────────────────────────────────────

class AccountViewModel
  extends BaseViewModel<AccountViewModelOptions>
  implements AccountViewModelInterface
{
  private readonly _account: AccountCapabilities;
  private readonly _backups: AccountBackupCapabilities;
  private readonly _isOnline: () => boolean;

  isBackupsLoading = $state(false);
  isSigningOut = $state(false);
  isRevokingAllSessions = $state(false);
  isDeleteDialogOpen = $state(false);
  deleteConfirmText = $state('');
  isDeleting = $state(false);
  backups = $state<BackupEntry[]>([]);

  constructor(options: AccountViewModelOptions) {
    super(options);
    this._account = options.account;
    this._backups = options.backups;
    this._isOnline =
      options.isOnline ?? (() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  }

  get isLoggedIn(): boolean {
    return this._account.isLoggedIn;
  }

  get displayName(): string | undefined {
    return this._account.currentUser?.displayName;
  }

  get email(): string | undefined {
    return this._account.currentUser?.email;
  }

  get isOnline(): boolean {
    return this._isOnline();
  }

  get showDeleteAccount(): boolean {
    return this.isLoggedIn;
  }

  override async initialize(): Promise<void> {
    if (this.isLoggedIn) {
      await this.refreshBackups();
    }
    await super.initialize();
  }

  async signOut(): Promise<boolean> {
    this.isSigningOut = true;
    try {
      const succeeded = await this._account.signOut();
      if (!succeeded) {
        this.error('signOut:failed');
        return false;
      }
      this.debug('signOut:success');
      return true;
    } catch (error) {
      this.error('signOut', error);
      return false;
    } finally {
      this.isSigningOut = false;
    }
  }

  async revokeAllSessions(): Promise<void> {
    this.isRevokingAllSessions = true;
    try {
      const succeeded = await this._account.revokeAllSessions();
      if (!succeeded) {
        this.error('revokeAllSessions:failed');
        return;
      }
      this.debug('revokeAllSessions:success');
    } catch (error) {
      this.error('revokeAllSessions', error);
    } finally {
      this.isRevokingAllSessions = false;
    }
  }

  async refreshBackups(): Promise<void> {
    this.isBackupsLoading = true;
    try {
      this.backups = await this._backups.listBackups();
    } catch (error) {
      this.error('refreshBackups', error);
    } finally {
      this.isBackupsLoading = false;
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
      const success = await this._account.deleteAccount();
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

/**
 * Builds an account ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getAccountViewModel` in ./account_composition.ts.
 */
export const createAccountViewModel = (
  options: AccountViewModelOptions,
): AccountViewModelInterface => AccountViewModel.create(options);
