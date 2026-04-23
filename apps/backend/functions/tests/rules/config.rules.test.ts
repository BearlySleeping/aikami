import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { cleanupTestEnvironment, getTestEnvironment } from './setup.ts';

describe('Firestore Rules — configs collection', () => {
	let env: RulesTestEnvironment;

	beforeAll(async () => {
		env = await getTestEnvironment();
	});

	afterAll(async () => {
		await cleanupTestEnvironment();
	});

	describe('authenticated owner', () => {
		test('should allow reading own config document', async () => {
			const user = env.authenticatedContext('user-123');
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await expect(doc.get()).resolves.toBeDefined();
		});

		test('should allow writing own config document', async () => {
			const user = env.authenticatedContext('user-123');
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await expect(
				doc.set({
					uid: 'user-123',
					theme: 'dark',
					locale: 'en',
				}),
			).resolves.toBeUndefined();
		});

		test('should allow updating own config document', async () => {
			const user = env.authenticatedContext('user-123');
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await doc.set({ uid: 'user-123', theme: 'dark' });

			await expect(doc.update({ theme: 'light' })).resolves.toBeUndefined();
		});

		test('should allow deleting own config document', async () => {
			const user = env.authenticatedContext('user-123');
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await doc.set({ uid: 'user-123', theme: 'dark' });

			await expect(doc.delete()).resolves.toBeUndefined();
		});
	});

	describe('authenticated other user', () => {
		test('should deny reading another users config document', async () => {
			const user = env.authenticatedContext('user-456');
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await expect(doc.get()).rejects.toBeDefined();
		});

		test('should deny writing another users config document', async () => {
			const user = env.authenticatedContext('user-456');
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await expect(
				doc.set({
					uid: 'user-123',
					theme: 'dark',
				}),
			).rejects.toBeDefined();
		});

		test('should deny updating another users config document', async () => {
			const owner = env.authenticatedContext('user-123');
			await owner.firestore().collection('configs').doc('user-123').set({ uid: 'user-123' });

			const other = env.authenticatedContext('user-456');
			const doc = other.firestore().collection('configs').doc('user-123');

			await expect(doc.update({ theme: 'light' })).rejects.toBeDefined();
		});

		test('should deny deleting another users config document', async () => {
			const owner = env.authenticatedContext('user-123');
			await owner.firestore().collection('configs').doc('user-123').set({ uid: 'user-123' });

			const other = env.authenticatedContext('user-456');
			const doc = other.firestore().collection('configs').doc('user-123');

			await expect(doc.delete()).rejects.toBeDefined();
		});
	});

	describe('unauthenticated user', () => {
		test('should deny reading any config document', async () => {
			const user = env.unauthenticatedContext();
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await expect(doc.get()).rejects.toBeDefined();
		});

		test('should deny writing any config document', async () => {
			const user = env.unauthenticatedContext();
			const db = user.firestore();
			const doc = db.collection('configs').doc('user-123');

			await expect(doc.set({ uid: 'user-123' })).rejects.toBeDefined();
		});
	});
});
