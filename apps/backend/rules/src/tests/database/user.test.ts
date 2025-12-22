import { afterAll, describe, expect, test } from 'vitest';
import { setup, teardown } from '$utils';
import { activeMemberAuth, activeMemberData } from '$mocks';
import { getUsersCollectionPath } from '$paths';

describe('Users rules', () => {
	afterAll(async () => {
		await teardown();
	});
	//  RULES FOR NOT SIGNED IN USERS //
	test('deny not signed in users to read/create/update/delete a user data', async () => {
		// Setup
		const db = await setup();
		const usersCollectionRef = db.collection(getUsersCollectionPath());
		const userDocRef = usersCollectionRef.doc('test-uid');
		// Deny read
		expect(usersCollectionRef.get()).toDeny();
		expect(userDocRef.get()).toDeny();

		// Deny create
		expect(usersCollectionRef.add(activeMemberData)).toDeny();
		expect(userDocRef.set(activeMemberData)).toDeny();

		// Deny update
		expect(userDocRef.update({ displayName: 'New DisplayName' })).toDeny();

		// Deny delete
		expect(userDocRef.delete()).toDeny();
	});

	//  RULES FOR SIGNED IN USERS //
	test("allow signed in users to read and update the user's document data, but deny the rest", async () => {
		// Setup
		const uid = activeMemberAuth.uid;
		const db = await setup({
			auth: activeMemberAuth,
		});
		const usersCollectionRef = db.collection(getUsersCollectionPath());
		const userDocRef = usersCollectionRef.doc(uid);
		// Allow read
		expect(usersCollectionRef.get()).toAllow();
		expect(userDocRef.get()).toAllow();

		// Deny create
		expect(usersCollectionRef.add(activeMemberData)).toDeny();
		expect(userDocRef.set(activeMemberData)).toDeny();

		// Allow update
		expect(userDocRef.update({ displayName: 'New DisplayName' })).toAllow();

		// Deny delete
		expect(userDocRef.delete()).toDeny();
	});
});
