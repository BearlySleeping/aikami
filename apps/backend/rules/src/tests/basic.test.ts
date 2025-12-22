import { setup, teardown } from '$utils';
import { afterAll, describe, expect, test } from 'vitest';

describe('Database rules', () => {
	// Applies only to tests in this describe block

	afterAll(async () => {
		await teardown();
	});

	test('fail when reading/writing an unauthorized collection', async () => {
		const db = await setup();

		// All paths are secure by default
		const ref = db.collection('some-nonexistent-collection');
		expect(ref.get()).toDeny();
	});
});
