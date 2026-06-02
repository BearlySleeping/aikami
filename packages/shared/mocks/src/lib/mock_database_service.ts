// packages/shared/mocks/src/lib/mock-database-service.ts
import type { BaseDatabaseService, QueryFilter, QueryOptions } from '@aikami/backend/database';

// ---------------------------------------------------------------------------
// In-memory document store
// ---------------------------------------------------------------------------

type CollectionMap = Map<string, Map<string, unknown>>;

/**
 * Pure in-memory implementation of {@link BaseDatabaseService}.
 *
 * Stores all data in `Map<string, Map<string, unknown>>` (collection → id →
 * document).  All methods return `Promise` to match the async interface, but
 * execution is synchronous — no network, no emulator, no filesystem I/O.
 *
 * Designed for **fast unit tests**.  Seed with {@link seedCollection}, run
 * assertions against the service, then call {@link reset} between test cases.
 *
 * **Coding rules:**
 * - Every public method opens with guard clauses.
 * - Every `if` body (even single-line) is wrapped in `{}`.
 * - Arrow-function class fields for all methods.
 */
export class MockDatabaseService implements BaseDatabaseService {
  // Root document store: collection path → (document id → document data)
  private store: CollectionMap = new Map();

  // -----------------------------------------------------------------------
  // Lifecycle helpers (NOT part of BaseDatabaseService — test-only)
  // -----------------------------------------------------------------------

  /**
   * Pre-populate a collection with test fixtures.
   *
   * Each document in `documents` is stored keyed by `id`.  If a document
   * lacks an `id` property it is stored under the string `"undefined"`.
   *
   * @param collection - Collection path (e.g. `'users'`, `'chats/abc/messages'`).
   * @param documents  - Array of document-shaped objects to seed.
   */
  seedCollection = (collection: string, documents: Array<Record<string, unknown>>): void => {
    let coll = this.store.get(collection);

    if (!coll) {
      coll = new Map<string, unknown>();
      this.store.set(collection, coll);
    }

    for (const doc of documents) {
      const id = String(doc.id ?? 'undefined');
      coll.set(id, structuredClone(doc));
    }
  };

  /**
   * Clear all seeded data, restoring the store to a pristine state.
   *
   * Call this in `beforeEach` (or equivalent) so every test case starts
   * with a clean database.
   */
  reset = (): void => {
    this.store.clear();
  };

  // -----------------------------------------------------------------------
  // BaseDatabaseService implementation
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  getDocument = async <T = unknown>(path: string, id: string): Promise<T | undefined> => {
    const coll = this.store.get(path);

    if (!coll) {
      return undefined;
    }

    const doc = coll.get(id);

    if (doc === undefined) {
      return undefined;
    }

    return structuredClone(doc) as T;
  };

  /** @inheritdoc */
  getDocuments = async <T = unknown>(collection: string, options?: QueryOptions): Promise<T[]> => {
    const coll = this.store.get(collection);

    if (!coll) {
      return [];
    }

    let results = Array.from(coll.values());

    // Apply filters
    if (options?.filters && options.filters.length > 0) {
      results = applyFilters(results, options.filters);
    }

    // Apply ordering
    if (options?.orderBy) {
      results = applyOrderBy(results, options.orderBy.field, options.orderBy.direction ?? 'asc');
    }

    // Apply startAfter cursor
    if (options?.startAfter !== undefined) {
      const cursorValue = resolveNestedValue(
        options.startAfter as Record<string, unknown>,
        options?.orderBy?.field ?? 'id',
      );
      const field = options?.orderBy?.field ?? 'id';
      const direction = options?.orderBy?.direction ?? 'asc';

      results = results.filter((doc) => {
        const val = resolveNestedValue(doc as Record<string, unknown>, field);
        const comparison = compareValues(val, cursorValue);

        return direction === 'asc' ? comparison > 0 : comparison < 0;
      });
    }

    // Apply limit
    if (options?.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return structuredClone(results) as T[];
  };

  /** @inheritdoc */
  addDocument = async <T = unknown>(collection: string, data: T): Promise<string> => {
    const id = crypto.randomUUID();
    const dataWithId = { ...(data as Record<string, unknown>), id };

    let coll = this.store.get(collection);

    if (!coll) {
      coll = new Map<string, unknown>();
      this.store.set(collection, coll);
    }

    coll.set(id, dataWithId);

    return id;
  };

  /** @inheritdoc */
  setDocument = async <T = unknown>(path: string, id: string, data: T): Promise<void> => {
    let coll = this.store.get(path);

    if (!coll) {
      coll = new Map<string, unknown>();
      this.store.set(path, coll);
    }

    coll.set(id, structuredClone(data as Record<string, unknown>));
  };

  /** @inheritdoc */
  updateDocument = async <T = unknown>(
    path: string,
    id: string,
    data: Partial<T>,
  ): Promise<void> => {
    const coll = this.store.get(path);

    if (!coll) {
      throw new Error(`Collection "${path}" does not exist — cannot update document "${id}".`);
    }

    const existing = coll.get(id);

    if (existing === undefined) {
      throw new Error(`Document "${id}" does not exist in collection "${path}" — cannot update.`);
    }

    coll.set(id, {
      ...(existing as Record<string, unknown>),
      ...(data as Record<string, unknown>),
    });
  };

  /** @inheritdoc */
  deleteDocument = async (path: string, id: string): Promise<void> => {
    const coll = this.store.get(path);

    if (!coll) {
      return;
    }

    coll.delete(id);
  };

  /** @inheritdoc */
  runQuery = async <T = unknown>(
    _query: string,
    _params?: Record<string, unknown>,
  ): Promise<T[]> => {
    // The mock does not parse engine-native queries — return empty array.
    // Real implementations (Data Connect, PostgreSQL) satisfy this contract.
    return [];
  };
}

// ---------------------------------------------------------------------------
// Internal helpers (module-level arrow functions)
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-notation field path against a flat or nested document.
 *
 * @example resolveNestedValue({ a: { b: 3 } }, 'a.b') → 3
 */
const resolveNestedValue = (doc: Record<string, unknown>, path: string): unknown => {
  const segments = path.split('.');

  let current: unknown = doc;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

/**
 * Apply an array of {@link QueryFilter} conditions against in-memory documents.
 */
const applyFilters = (documents: unknown[], filters: QueryFilter[]): unknown[] => {
  return documents.filter((doc) => {
    const record = doc as Record<string, unknown>;

    return filters.every((filter) => {
      const fieldValue = resolveNestedValue(record, filter.field);

      return evaluateFilter(fieldValue, filter.operator, filter.value);
    });
  });
};

/**
 * Evaluate a single filter condition in-memory.
 */
const evaluateFilter = (
  fieldValue: unknown,
  operator: QueryFilter['operator'],
  compareValue: unknown,
): boolean => {
  switch (operator) {
    case '==': {
      return fieldValue === compareValue;
    }

    case '!=': {
      return fieldValue !== compareValue;
    }

    case '<': {
      assertComparable(fieldValue, compareValue);

      return (fieldValue as number) < (compareValue as number);
    }

    case '<=': {
      assertComparable(fieldValue, compareValue);

      return (fieldValue as number) <= (compareValue as number);
    }

    case '>': {
      assertComparable(fieldValue, compareValue);

      return (fieldValue as number) > (compareValue as number);
    }

    case '>=': {
      assertComparable(fieldValue, compareValue);

      return (fieldValue as number) >= (compareValue as number);
    }

    case 'in': {
      if (!Array.isArray(compareValue)) {
        return false;
      }

      return compareValue.includes(fieldValue);
    }

    case 'not-in': {
      if (!Array.isArray(compareValue)) {
        return true;
      }

      return !compareValue.includes(fieldValue);
    }

    case 'array-contains': {
      if (!Array.isArray(fieldValue)) {
        return false;
      }

      return fieldValue.includes(compareValue);
    }

    case 'array-contains-any': {
      if (!Array.isArray(fieldValue) || !Array.isArray(compareValue)) {
        return false;
      }

      return compareValue.some((v) => fieldValue.includes(v));
    }

    default: {
      // Exhaustiveness check — should never reach here.
      void (operator as never);

      return false;
    }
  }
};

/**
 * Guard: throw when the two values cannot be compared with `<`, `<=`, `>`, `>=`.
 */
const assertComparable = (a: unknown, b: unknown): void => {
  if (typeof a !== 'number' && typeof a !== 'string') {
    throw new TypeError(`Cannot compare value of type ${typeof a} with operator.`);
  }

  if (typeof b !== 'number' && typeof b !== 'string') {
    throw new TypeError(`Cannot compare value of type ${typeof b} with operator.`);
  }
};

/**
 * Compare two values for cursor-based pagination.
 *
 * Returns negative if `a < b`, positive if `a > b`, 0 if equal.
 * Handles string, number, and nullish values consistently.
 */
const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) {
    return 0;
  }

  if (a === undefined || a === null) {
    return 1;
  }

  if (b === undefined || b === null) {
    return -1;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  }

  const numA = Number(a);
  const numB = Number(b);

  return numA - numB;
};

/**
 * Sort documents by a dot-notation field path.
 */
const applyOrderBy = (
  documents: unknown[],
  field: string,
  direction: 'asc' | 'desc',
): unknown[] => {
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...documents].sort((a, b) => {
    const valA = resolveNestedValue(a as Record<string, unknown>, field);
    const valB = resolveNestedValue(b as Record<string, unknown>, field);

    if (valA === valB) {
      return 0;
    }

    if (valA === undefined || valA === null) {
      return 1;
    }

    if (valB === undefined || valB === null) {
      return -1;
    }

    if (typeof valA === 'string' && typeof valB === 'string') {
      return valA.localeCompare(valB) * multiplier;
    }

    const numA = Number(valA);
    const numB = Number(valB);

    return (numA - numB) * multiplier;
  });
};
