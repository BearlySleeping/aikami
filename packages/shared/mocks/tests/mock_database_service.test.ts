// packages/shared/mocks/tests/mock-database-service.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { MockDatabaseService } from '../src/lib/mock-database-service';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type TestUser = {
  id: string;
  name: string;
  email: string;
  age: number;
};

const alice: TestUser = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
};

const bob: TestUser = {
  id: 'user-2',
  name: 'Bob',
  email: 'bob@example.com',
  age: 25,
};

const carol: TestUser = {
  id: 'user-3',
  name: 'Carol',
  email: 'carol@example.com',
  age: 35,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MockDatabaseService', () => {
  let db: MockDatabaseService;

  beforeEach(() => {
    db = new MockDatabaseService();
  });

  // -----------------------------------------------------------------------
  // seedCollection & reset
  // -----------------------------------------------------------------------

  describe('seedCollection', () => {
    it('should seed documents and retrieve them via getDocument', async () => {
      db.seedCollection('users', [alice, bob]);

      const result = await db.getDocument<TestUser>('users', 'user-1');

      expect(result).toBeDefined();
      expect(result!.name).toBe('Alice');
      expect(result!.email).toBe('alice@example.com');
    });

    it('should return the correct number of documents via getDocuments', async () => {
      db.seedCollection('users', [alice, bob, carol]);

      const results = await db.getDocuments<TestUser>('users');

      expect(results).toHaveLength(3);
    });

    it('should assign id "undefined" when document has no id field', async () => {
      db.seedCollection('users', [{ name: 'NoId' }]);

      const result = await db.getDocument('users', 'undefined');

      expect(result).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should clear all seeded data', async () => {
      db.seedCollection('users', [alice]);
      db.reset();

      const result = await db.getDocument('users', 'user-1');

      expect(result).toBeUndefined();
    });

    it('should clear multiple collections', async () => {
      db.seedCollection('users', [alice]);
      db.seedCollection('chats', [{ id: 'chat-1', title: 'General' }]);
      db.reset();

      expect(await db.getDocument('users', 'user-1')).toBeUndefined();
      expect(await db.getDocument('chats', 'chat-1')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getDocument
  // -----------------------------------------------------------------------

  describe('getDocument', () => {
    it('should return undefined for a non-existent collection', async () => {
      const result = await db.getDocument('nonexistent', 'any');

      expect(result).toBeUndefined();
    });

    it('should return undefined for a non-existent document', async () => {
      db.seedCollection('users', [alice]);

      const result = await db.getDocument('users', 'nonexistent');

      expect(result).toBeUndefined();
    });

    it('should return a cloned copy (not a reference)', async () => {
      db.seedCollection('users', [alice]);
      const doc = await db.getDocument<TestUser>('users', 'user-1');
      doc!.name = 'Mutated';

      const fresh = await db.getDocument<TestUser>('users', 'user-1');

      expect(fresh!.name).toBe('Alice');
    });
  });

  // -----------------------------------------------------------------------
  // getDocuments
  // -----------------------------------------------------------------------

  describe('getDocuments', () => {
    it('should return empty array for non-existent collection', async () => {
      const results = await db.getDocuments('nonexistent');

      expect(results).toEqual([]);
    });

    it('should return all documents when no options', async () => {
      db.seedCollection('users', [alice, bob]);

      const results = await db.getDocuments<TestUser>('users');

      expect(results).toHaveLength(2);
    });

    it('should filter with == operator', async () => {
      db.seedCollection('users', [alice, bob, carol]);

      const results = await db.getDocuments<TestUser>('users', {
        filters: [{ field: 'name', operator: '==', value: 'Alice' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('should filter with != operator', async () => {
      db.seedCollection('users', [alice, bob]);

      const results = await db.getDocuments<TestUser>('users', {
        filters: [{ field: 'name', operator: '!=', value: 'Alice' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Bob');
    });

    it('should filter with > operator', async () => {
      db.seedCollection('users', [alice, bob, carol]);

      const results = await db.getDocuments<TestUser>('users', {
        filters: [{ field: 'age', operator: '>', value: 25 }],
      });

      expect(results).toHaveLength(2);
    });

    it('should filter with in operator', async () => {
      db.seedCollection('users', [alice, bob, carol]);

      const results = await db.getDocuments<TestUser>('users', {
        filters: [{ field: 'name', operator: 'in', value: ['Alice', 'Carol'] }],
      });

      expect(results).toHaveLength(2);
    });

    it('should limit results', async () => {
      db.seedCollection('users', [alice, bob, carol]);

      const results = await db.getDocuments<TestUser>('users', { limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('should order by field ascending', async () => {
      db.seedCollection('users', [carol, alice, bob]);

      const results = await db.getDocuments<TestUser>('users', {
        orderBy: { field: 'name', direction: 'asc' },
      });

      expect(results[0]!.name).toBe('Alice');
      expect(results[1]!.name).toBe('Bob');
      expect(results[2]!.name).toBe('Carol');
    });

    it('should order by field descending', async () => {
      db.seedCollection('users', [alice, carol, bob]);

      const results = await db.getDocuments<TestUser>('users', {
        orderBy: { field: 'age', direction: 'desc' },
      });

      expect(results[0]!.age).toBe(35);
      expect(results[1]!.age).toBe(30);
      expect(results[2]!.age).toBe(25);
    });

    it('should combine filter, order, and limit', async () => {
      db.seedCollection('users', [alice, bob, carol]);

      const results = await db.getDocuments<TestUser>('users', {
        filters: [{ field: 'age', operator: '>', value: 20 }],
        orderBy: { field: 'age', direction: 'desc' },
        limit: 2,
      });

      expect(results).toHaveLength(2);
      expect(results[0]!.age).toBe(35);
      expect(results[1]!.age).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // addDocument
  // -----------------------------------------------------------------------

  describe('addDocument', () => {
    it('should add a document and return an id', async () => {
      const id = await db.addDocument('users', {
        name: 'Dave',
        email: 'dave@example.com',
      });

      expect(id).toBeString();
      expect(id).not.toBeEmpty();

      const doc = await db.getDocument('users', id);
      expect(doc).toBeDefined();
    });

    it('should auto-create the collection if it does not exist', async () => {
      const id = await db.addDocument('brand_new', { value: 42 });

      expect(id).toBeString();
    });

    it('should generate unique ids', async () => {
      const id1 = await db.addDocument('users', { name: 'A' });
      const id2 = await db.addDocument('users', { name: 'B' });

      expect(id1).not.toBe(id2);
    });
  });

  // -----------------------------------------------------------------------
  // setDocument
  // -----------------------------------------------------------------------

  describe('setDocument', () => {
    it('should create a document at a specific id', async () => {
      await db.setDocument('users', 'custom-id', { name: 'Custom' });

      const doc = await db.getDocument('users', 'custom-id');
      expect(doc).toBeDefined();
    });

    it('should overwrite an existing document', async () => {
      db.seedCollection('users', [alice]);
      await db.setDocument('users', 'user-1', { name: 'Replaced', age: 99 });

      const doc = await db.getDocument<{ name: string; age: number }>(
        'users',
        'user-1',
      );
      expect(doc!.name).toBe('Replaced');
      expect(doc!.age).toBe(99);
    });
  });

  // -----------------------------------------------------------------------
  // updateDocument
  // -----------------------------------------------------------------------

  describe('updateDocument', () => {
    it('should merge partial data into an existing document', async () => {
      db.seedCollection('users', [alice]);

      await db.updateDocument('users', 'user-1', { age: 31 });

      const doc = await db.getDocument<TestUser>('users', 'user-1');
      expect(doc!.age).toBe(31);
      expect(doc!.name).toBe('Alice'); // unchanged
    });

    it('should throw when collection does not exist', async () => {
      const promise = db.updateDocument('ghost', 'any', { x: 1 });

      await expect(promise).rejects.toThrow(
        'Collection "ghost" does not exist',
      );
    });

    it('should throw when document does not exist', async () => {
      db.seedCollection('users', [alice]);

      const promise = db.updateDocument('users', 'missing', { name: 'X' });

      await expect(promise).rejects.toThrow(
        'Document "missing" does not exist in collection "users"',
      );
    });
  });

  // -----------------------------------------------------------------------
  // deleteDocument
  // -----------------------------------------------------------------------

  describe('deleteDocument', () => {
    it('should delete an existing document', async () => {
      db.seedCollection('users', [alice]);
      await db.deleteDocument('users', 'user-1');

      const doc = await db.getDocument('users', 'user-1');
      expect(doc).toBeUndefined();
    });

    it('should no-op when collection does not exist', async () => {
      // Should not throw
      await db.deleteDocument('nonexistent', 'any');
    });

    it('should no-op when document does not exist', async () => {
      db.seedCollection('users', [alice]);

      // Should not throw
      await db.deleteDocument('users', 'missing');
    });
  });

  // -----------------------------------------------------------------------
  // runQuery
  // -----------------------------------------------------------------------

  describe('runQuery', () => {
    it('should return empty array (mock does not parse queries)', async () => {
      const results = await db.runQuery('SELECT * FROM users');

      expect(results).toEqual([]);
    });
  });
});
