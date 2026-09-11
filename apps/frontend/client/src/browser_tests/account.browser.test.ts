// apps/frontend/client/src/browser_tests/account.browser.test.ts
//
// Real-runes coverage for the migrated account feature.
//
// The Bun account suite verifies the explicit collaborators with a real base
// class, but its rune polyfills are identity functions — it cannot observe a
// reactive identity change or a transient loading flag. This lane runs the same
// ViewModel in Chromium with the real Svelte compiler, against a reactive
// account fixture (test/testing/account_reactive_fixtures.svelte.ts).

import type { BackupEntry } from '@aikami/frontend/services/backup_client';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import {
  type AccountBackupCapabilities,
  createAccountViewModel,
} from '../lib/views/settings/account/account_view_model.svelte';
import { createReactiveAccountHarness } from '../lib/views/settings/account/testing/account_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

const createViewModel = (options: {
  account: ReturnType<typeof createReactiveAccountHarness>['account'];
  backups?: AccountBackupCapabilities;
}) => {
  const viewModel = createAccountViewModel({
    className: 'AccountViewModel',
    account: options.account,
    backups: options.backups ?? { listBackups: async () => [] },
  });
  disposables.push(() => viewModel.dispose());
  return viewModel;
};

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('AccountViewModel — reactive identity (real runes)', () => {
  test('changing the user updates exposed identity and login state', () => {
    const harness = createReactiveAccountHarness();
    const viewModel = createViewModel({ account: harness.account });

    expect(viewModel.isLoggedIn).toBe(false);
    expect(viewModel.showDeleteAccount).toBe(false);

    harness.signIn({ displayName: 'Aria', email: 'aria@example.com', uid: 'uid-1' });
    flushSync();

    expect(viewModel.isLoggedIn).toBe(true);
    expect(viewModel.displayName).toBe('Aria');
    expect(viewModel.email).toBe('aria@example.com');
    expect(viewModel.showDeleteAccount).toBe(true);

    harness.signOut();
    flushSync();

    expect(viewModel.isLoggedIn).toBe(false);
    expect(viewModel.displayName).toBeUndefined();
    expect(viewModel.email).toBeUndefined();
  });
});

describe('AccountViewModel — async flags (real runes)', () => {
  test('a pending backup fetch sets isBackupsLoading then clears it', async () => {
    const harness = createReactiveAccountHarness();
    harness.signIn({ displayName: 'Aria', email: 'aria@example.com', uid: 'uid-1' });

    let resolveBackups: ((backups: BackupEntry[]) => void) | undefined;
    const listBackups = (): Promise<BackupEntry[]> =>
      new Promise((resolve) => {
        resolveBackups = resolve;
      });

    const viewModel = createViewModel({ account: harness.account, backups: { listBackups } });

    const pending = viewModel.refreshBackups();
    expect(viewModel.isBackupsLoading).toBe(true);

    resolveBackups?.([]);
    await pending;
    flushSync();

    expect(viewModel.isBackupsLoading).toBe(false);
    expect(viewModel.backups).toEqual([]);
  });

  test('a rejected signOut clears isSigningOut without throwing', async () => {
    const harness = createReactiveAccountHarness({
      signOut: async () => {
        throw new Error('network down');
      },
    });
    const viewModel = createViewModel({ account: harness.account });

    await expect(viewModel.signOut()).resolves.toBe(false);
    expect(viewModel.isSigningOut).toBe(false);
  });

  test('an unsuccessful revokeAllSessions clears isRevokingAllSessions', async () => {
    const harness = createReactiveAccountHarness({ revokeAllSessions: async () => false });
    const viewModel = createViewModel({ account: harness.account });

    await viewModel.revokeAllSessions();

    expect(viewModel.isRevokingAllSessions).toBe(false);
  });

  test('a failed delete keeps the dialog open and clears isDeleting', async () => {
    const harness = createReactiveAccountHarness({ deleteAccount: async () => false });
    const viewModel = createViewModel({ account: harness.account });

    viewModel.openDeleteDialog();
    viewModel.updateDeleteConfirmText('DELETE');
    await viewModel.confirmDeleteAccount();

    expect(viewModel.isDeleting).toBe(false);
    expect(viewModel.isDeleteDialogOpen).toBe(true);
  });

  test('a successful delete closes the dialog', async () => {
    const harness = createReactiveAccountHarness({ deleteAccount: async () => true });
    const viewModel = createViewModel({ account: harness.account });

    viewModel.openDeleteDialog();
    viewModel.updateDeleteConfirmText('DELETE');
    await viewModel.confirmDeleteAccount();

    expect(viewModel.isDeleting).toBe(false);
    expect(viewModel.isDeleteDialogOpen).toBe(false);
  });
});
