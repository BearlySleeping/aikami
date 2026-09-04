// apps/frontend/client/src/lib/views/settings/account/account_view_model.test.ts
//
// C-464 AC-1/2/7: Account settings section tests.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock authService
const mockSignOut = mock(async () => true);
const mockDeleteAccount = mock(async () => true);
const mockListSlots = mock(async () => []);
const mockAuthService = {
	isLoggedIn: false,
	currentUser: undefined as
		| { id: string; displayName: string; email: string }
		| undefined,
	uid: undefined as string | undefined,
	signOut: mockSignOut,
	deleteAccount: mockDeleteAccount,
	setCurrentUser: mock(() => {}),
};

mock.module('$services', () => ({
	authService: mockAuthService,
	gameStateSyncService: {
		listSlots: mockListSlots,
	},
	hubApiBase: () => '/api/hub',
	hubAuthHeaders: () => ({}),
}));

let getAccountViewModel: typeof import('./account_view_model.svelte').getAccountViewModel;

beforeEach(async () => {
	mockAuthService.isLoggedIn = false;
	mockAuthService.currentUser = undefined;
	mockAuthService.uid = undefined;
	mockSignOut.mockClear();
	mockDeleteAccount.mockClear();
	mockListSlots.mockClear();
	({ getAccountViewModel } = await import('./account_view_model.svelte'));
});

describe('AccountViewModel — AC-1: Signed-out state', () => {
	test('shows signed-out state when not logged in', async () => {
		const vm = getAccountViewModel({ className: 'AccountViewModel' });

		expect(vm.isLoggedIn).toBe(false);
		expect(vm.displayName).toBeUndefined();
		expect(vm.email).toBeUndefined();
		expect(vm.showDeleteAccount).toBe(false);
	});

	test('does not offer sync controls when signed out', async () => {
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
		mockAuthService.isLoggedIn = true;
		mockAuthService.currentUser = {
			id: 'test-uid',
			displayName: 'Test User',
			email: 'test@example.com',
		};
		mockAuthService.uid = 'test-uid';
		const vm = getAccountViewModel({ className: 'AccountViewModel' });
		await vm.initialize();

		expect(vm.isLoggedIn).toBe(true);
		expect(vm.displayName).toBe('Test User');
		expect(vm.email).toBe('test@example.com');
		expect(vm.showDeleteAccount).toBe(true);
		expect(mockListSlots).toHaveBeenCalled();
		expect(vm.syncSlots).toContainEqual({
			slotNumber: 1,
			lastLocationName: 'Test Location',
			playedTimeSeconds: null,
			storageRef: 'saves/test-uid/slot_1.json',
			updatedAt: '2026-09-04T00:00:00.000Z',
		});
	});
});

describe('AccountViewModel — AC-7: Delete account type-to-confirm', () => {
	test('confirm requires DELETE text', async () => {
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
