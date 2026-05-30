// packages/backend/database/tests/user-repository.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { MockDatabaseService } from '../../../shared/mocks/src/lib/mock_database_service.ts';
import type { BaseDatabaseService } from '../src/lib/base-database-service';
import { FirebaseDataConnectService } from '../src/lib/firebase-data-connect-service';
import {
  type CreateUserInput,
  UserRepository,
} from '../src/lib/user-repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a test user input with a unique email to avoid collisions.
 */
const makeUser = (suffix = ''): CreateUserInput => {
  const tag = suffix || Math.random().toString(36).slice(2, 8);

  return {
    displayName: `Test User ${tag}`,
    email: `test-${tag}@example.com`,
    role: 'user',
    firstName: 'Test',
    lastName: 'User',
  };
};

/**
 * Skip integration tests when no Data Connect emulator is available.
 */
const skipIfNoEmulator = (): boolean => {
  const host = process.env.DATA_CONNECT_EMULATOR_HOST;

  return !host;
};

// ---------------------------------------------------------------------------
// Test runner factory
// ---------------------------------------------------------------------------

/**
 * Run the full UserRepository test battery against a {@link BaseDatabaseService}
 * implementation.  Call this once for the mock and once for the real service.
 */
const runRepositoryTests = (
  label: string,
  createDb: () => BaseDatabaseService,
  setup?: (db: BaseDatabaseService) => void | Promise<void>,
  teardown?: (db: BaseDatabaseService) => void | Promise<void>,
): void => {
  describe(`UserRepository — ${label}`, () => {
    let db: BaseDatabaseService;
    let repo: UserRepository;

    beforeEach(async () => {
      db = createDb();
      repo = new UserRepository(db);

      if (setup) {
        await setup(db);
      }
    });

    afterEach(async () => {
      if (teardown) {
        await teardown(db);
      }
    });

    // -------------------------------------------------------------------
    // create
    // -------------------------------------------------------------------

    it('should create a user and return an id', async () => {
      const input = makeUser();
      const id = await repo.create(input);

      expect(id).toBeString();
      expect(id).not.toBeEmpty();
    });

    it('should create a user that is retrievable by id', async () => {
      const input = makeUser();
      const id = await repo.create(input);
      const user = await repo.findById(id);

      expect(user).toBeDefined();
      expect(user!.email).toBe(input.email);
    });

    it('should throw when email is missing', async () => {
      const promise = repo.create({
        displayName: 'No Email',
        email: '',
        role: 'user',
      });

      await expect(promise).rejects.toThrow('email is required.');
    });

    // -------------------------------------------------------------------
    // findById
    // -------------------------------------------------------------------

    it('should return undefined for a non-existent user', async () => {
      const user = await repo.findById('nonexistent');

      expect(user).toBeUndefined();
    });

    it('should return the correct user by id', async () => {
      const input = makeUser('alice');
      const id = await repo.create(input);
      const user = await repo.findById(id);

      expect(user!.displayName).toBe(input.displayName);
      expect(user!.role).toBe('user');
    });

    // -------------------------------------------------------------------
    // findAll
    // -------------------------------------------------------------------

    it('should return all users', async () => {
      await repo.create(makeUser('a'));
      await repo.create(makeUser('b'));
      await repo.create(makeUser('c'));

      const users = await repo.findAll();

      expect(users.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty array when no users exist', async () => {
      const users = await repo.findAll();

      expect(users).toEqual([]);
    });

    // -------------------------------------------------------------------
    // findByRole
    // -------------------------------------------------------------------

    it('should filter users by role', async () => {
      await repo.create({ ...makeUser('admin1'), role: 'admin' });
      await repo.create({ ...makeUser('admin2'), role: 'admin' });
      await repo.create({ ...makeUser('user1'), role: 'user' });

      const admins = await repo.findByRole('admin');

      expect(admins.length).toBe(2);
    });

    // -------------------------------------------------------------------
    // set
    // -------------------------------------------------------------------

    it('should overwrite a user at a specific id', async () => {
      const id = 'custom-id';
      await repo.set(id, makeUser('original'));

      const user = await repo.findById(id);

      expect(user).toBeDefined();
      expect(user!.id).toBe(id);
    });

    // -------------------------------------------------------------------
    // update
    // -------------------------------------------------------------------

    it('should merge partial data', async () => {
      const input = makeUser('partial-test');
      const id = await repo.create(input);

      await repo.update(id, { displayName: 'Updated Name' });

      const user = await repo.findById(id);

      expect(user!.displayName).toBe('Updated Name');
      expect(user!.email).toBe(input.email); // unchanged
    });

    // -------------------------------------------------------------------
    // remove
    // -------------------------------------------------------------------

    it('should delete a user', async () => {
      const id = await repo.create(makeUser('to-delete'));
      await repo.remove(id);

      const user = await repo.findById(id);

      expect(user).toBeUndefined();
    });

    it('should no-op when deleting a non-existent user', async () => {
      // Should not throw
      await repo.remove('does-not-exist');
    });
  });
};

// =========================================================================
// Unit tests — MockDatabaseService (fast, always run)
// =========================================================================

runRepositoryTests('MockDatabaseService', () => {
  return new MockDatabaseService();
});

// =========================================================================
// Integration tests — FirebaseDataConnectService (requires emulator)
// =========================================================================

const describeIntegration = skipIfNoEmulator() ? describe.skip : describe;

describeIntegration('FirebaseDataConnectService (integration)', () => {
  let db: FirebaseDataConnectService;

  beforeEach(() => {
    db = new FirebaseDataConnectService({
      serviceId: 'aikami-db',
      connectorId: 'aikami-connector',
      location: 'us-central1',
      projectId: 'aikami-dev',
      useEmulator: true,
    });
  });

  // Smoke test: does the service initialise without errors?
  it('should initialise the Data Connect connector', () => {
    // Access a private member via type assertion to verify init happened.
    expect(db).toBeDefined();
  });

  // Run full CRUD battery
  runRepositoryTests(
    'FirebaseDataConnectService',
    () =>
      new FirebaseDataConnectService({
        serviceId: 'aikami-db',
        connectorId: 'aikami-connector',
        location: 'us-central1',
        projectId: 'aikami-dev',
        useEmulator: true,
      }),
  );
});
