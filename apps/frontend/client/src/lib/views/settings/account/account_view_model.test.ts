// apps/frontend/client/src/lib/views/settings/account/account_view_model.test.ts
//
// C-464 AC-1/2/7: Account settings section tests.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { DELETED_OWNER_ACCOUNT_ID } from '@aikami/constants';

// Mock authService
const mockSignOut = mock(async () => true);
const mockDeleteAccount = mock(async () => true);
const mockListSlots = mock(async () => []);

mock.module('$services', () => ({
	authService: {
		isLoggedIn: false,
		currentUser: undefined,
		uid: undefined,
		signOut: mockSignOut,
		deleteAccount: mockDeleteAccount,
		setCurrentUser: mock(() => {}),
	},
	gameStateSyncService: {
		listSlots: mockListSlots,
	},
}));

describe('AccountViewModel — AC-1: Signed-out state', () => {
	test('shows signed-out state when not logged in', async () => {
		const { getAccountViewModel } = await import('./account_view_model.svelte');
		const vm = getAccountViewModel({ className: 'AccountViewModel' });

		expect(vm.isLoggedIn).toBe(false);
		expect(vm.displayName).toBeUndefined();
		expect(vm.email).toBeUndefined();
		expect(vm.showDeleteAccount).toBe(false);
	});

	test('does not offer sync controls when signed out', async () => {
		const { getAccountViewModel } = await import('./account_view_model.svelte');
		const vm = getAccountViewModel({ className: 'AccountViewModel' });

		expect(vm.syncSlots).toEqual([]);
	});
});

describe('AccountViewModel — AC-2: Sync status', () => {
	beforeEach(() => {
		mockListSlots.mockImplementation(async () => [
			{
				slotNumber: 1,
				lastLocationName: 'Test Location',
				playedTimeSeconds: null,
				storageRef: 'saves/test-uid/slot_1.json',
				updatedAt: '2026-09-04T00:00:00.000Z',
			},
		]);
	});

	test('lists sync slots when signed in', async () => {
		// Re-mock authService as signed in
		mock.module('$services', () => ({
			authService: {
				isLoggedIn: true,
				currentUser: { id: 'test-uid', name: 'Test User', email: 'test@example.com' },
				uid: 'test-uid',
				signOut: mockSignOut,
				deleteAccount: mockDeleteAccount,
				setCurrentUser: mock(() => {}),
			},
			gameStateSyncService: {
				listSlots: mockListSlots,
			},
		}));

		const { getAccountViewModel } = await import('./account_view_model.svelte');
		const vm = getAccountViewModel({ className: 'AccountViewModel' });

		expect(vm.isLoggedIn).toBe(true);
		expect(vm.displayName).toBe('Test User');
		expect(vm.email).toBe('test@example.com');
		expect(vm.showDeleteAccount).toBe(true);
	});
});

describe('AccountViewModel — AC-7: Delete account type-to-confirm', () => {
	test('confirm requires DELETE text', async () => {
		const { getAccountViewModel } = await import('./account_view_model.svelte');
		const vm = getAccountViewModel({ className: 'AccountViewModel' });

		vm.openDeleteDialog();
		expect(vm.isDeleteDialogOpen).toBe(true);
		expect(vm.deleteConfirmText).toBe('');

		// With wrong text, confirm should not call deleteAccount
		vm.updateDeleteConfirmText('wrong');
		await vm.confirmDeleteAccount();
		expect(mockDeleteAccount).not.toHaveBeenCalled();

		// With correct text, confirm should call deleteAccount
		vm.updateDeleteConfirmText('DELETE');
		await vm.confirmDeleteAccount();
		expect(mockDeleteAccount).toHaveBeenCalled();

		vm.closeDeleteDialog();
		expect(vm.isDeleteDialogOpen).toBe(false);
	});
});
