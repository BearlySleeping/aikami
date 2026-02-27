import { afterAll, describe, expect, test } from 'vitest';
import { setup, teardown } from '$utils';

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
