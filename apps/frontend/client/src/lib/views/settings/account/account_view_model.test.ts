// apps/frontend/client/src/lib/views/settings/account/account_view_model.test.ts
//
// C-464 AC-1/2/7: Account settings section tests.
//
// This suite exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock and no dependency on the test_preload mock
// inventory. Each test constructs exactly the capabilities it needs.

import { describe, expect, mock, test } from 'bun:test';
import type { BackupEntry } from '@aikami/frontend/services/backup_client';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  type AccountBackupCapabilities,
  type AccountCapabilities,
  createAccountViewModel,
} from './account_view_model.svelte';
import {
  createBackupCapabilities,
  createSignedInAccount,
  createSignedOutAccount,
} from './testing/account_fixtures.ts';

const createViewModel = (
  options: {
    account?: AccountCapabilities;
    backups?: AccountBackupCapabilities;
    isOnline?: () => boolean;
  } = {},
) =>
  createAccountViewModel({
    className: 'AccountViewModel',
    account: options.account ?? createSignedOutAccount(),
    backups: options.backups ?? createBackupCapabilities(),
    isOnline: options.isOnline,
  });

describe('AccountViewModel — AC-1: Signed-out state', () => {
  test('shows signed-out state when not logged in', () => {
    const viewModel = createViewModel();

    expect(viewModel.isLoggedIn).toBe(false);
    expect(viewModel.displayName).toBeUndefined();
    expect(viewModel.email).toBeUndefined();
    expect(viewModel.showDeleteAccount).toBe(false);
  });

  test('does not offer backup controls when signed out', () => {
    const viewModel = createViewModel();

    expect(viewModel.backups).toEqual([]);
  });
});

describe('AccountViewModel — AC-2: Cloud backups', () => {
  test('lists backups when signed in', async () => {
    const backups: BackupEntry[] = [
      {
        id: 'backup-1',
        r2Key: 'backups/test-uid/backup-1.db',
        sizeBytes: 2048,
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    ];
    const listBackups = mock(async () => backups);
    const viewModel = createViewModel({
      account: createSignedInAccount(),
      backups: createBackupCapabilities({ listBackups }),
    });

    await viewModel.initialize();

    expect(viewModel.isLoggedIn).toBe(true);
    expect(viewModel.displayName).toBe('Test User');
    expect(viewModel.email).toBe('test@example.com');
    expect(viewModel.showDeleteAccount).toBe(true);
    expect(listBackups).toHaveBeenCalledTimes(1);
    expect(viewModel.backups).toEqual(backups);
  });

  test('does not query backups while signed out', async () => {
    const listBackups = mock(async () => []);
    const viewModel = createViewModel({
      account: createSignedOutAccount(),
      backups: createBackupCapabilities({ listBackups }),
    });

    await viewModel.initialize();

    expect(listBackups).not.toHaveBeenCalled();
  });
});

describe('AccountViewModel — session actions', () => {
  test('signOut delegates to the account capability', async () => {
    const signOut = mock(async () => true);
    const viewModel = createViewModel({
      account: createSignedInAccount({ signOut }),
    });

    await expect(viewModel.signOut()).resolves.toBe(true);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(viewModel.isSigningOut).toBe(false);
  });

  test('revokeAllSessions delegates to the account capability', async () => {
    const revokeAllSessions = mock(async () => true);
    const viewModel = createViewModel({
      account: createSignedInAccount({ revokeAllSessions }),
    });

    await viewModel.revokeAllSessions();

    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(viewModel.isRevokingAllSessions).toBe(false);
  });
});

describe('AccountViewModel — platform capabilities', () => {
  test('isOnline reflects the injected probe', () => {
    const viewModel = createViewModel({ isOnline: () => false });

    expect(viewModel.isOnline).toBe(false);
  });
});

describe('AccountViewModel — real base class', () => {
  test('extends the production BaseViewModel, not a shared fake', async () => {
    const viewModel = createViewModel();

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    // The preload's old MockBaseViewModel lacked registerEffectRoot; its
    // dispose() also left __mounted untouched. Both assertions pin the real base.
    expect('registerEffectRoot' in viewModel).toBe(true);

    viewModel.__mounted = true;
    await viewModel.dispose();
    expect(viewModel.__mounted).toBe(false);
  });
});

describe('AccountViewModel — AC-7: Delete account type-to-confirm', () => {
  test('confirm requires DELETE text', async () => {
    const deleteAccount = mock(async () => true);
    const viewModel = createViewModel({
      account: createSignedInAccount({ deleteAccount }),
    });

    viewModel.openDeleteDialog();
    expect(viewModel.isDeleteDialogOpen).toBe(true);
    expect(viewModel.deleteConfirmText).toBe('');

    // With wrong text, confirm should not call deleteAccount
    viewModel.updateDeleteConfirmText('wrong');
    await viewModel.confirmDeleteAccount();
    expect(deleteAccount).not.toHaveBeenCalled();

    // With correct text, confirm should call deleteAccount
    viewModel.updateDeleteConfirmText('DELETE');
    await viewModel.confirmDeleteAccount();
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    viewModel.closeDeleteDialog();
    expect(viewModel.isDeleteDialogOpen).toBe(false);
  });
});
