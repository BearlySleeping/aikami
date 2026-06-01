// packages/backend/database/src/lib/base-database-service.ts

// ---------------------------------------------------------------------------
// Vendor-agnostic query types — no Firebase / Firestore / Data Connect imports
// ---------------------------------------------------------------------------

/**
 * Comparison operators supported by the database abstraction.
 * These map to the lowest common denominator across Firestore, PostgreSQL, and in-memory stores.
 */
export type QueryOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not-in'
  | 'array-contains'
  | 'array-contains-any';

/**
 * A single filter condition applied to a collection query.
 */
export type QueryFilter = {
  /** Document field path (supports dot-notation for nested keys). */
  field: string;
  /** Comparison operator. */
  operator: QueryOperator;
  /** Value to compare against. */
  value: unknown;
};

/**
 * Sort direction for ordered queries.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Order-by clause for collection queries.
 */
export type OrderBy = {
  /** Document field path. */
  field: string;
  /** Sort direction — defaults to 'asc'. */
  direction?: SortDirection;
};

/**
 * Options bag for collection-scoped read queries.
 */
export type QueryOptions = {
  /** Filters to narrow the result set. */
  filters?: QueryFilter[];
  /** Maximum number of documents to return. */
  limit?: number;
  /** Sort ordering. */
  orderBy?: OrderBy;
  /** Cursor — return documents after this value (pagination). */
  startAfter?: unknown;
};

// ---------------------------------------------------------------------------
// BaseDatabaseService — OOP abstraction contract
// ---------------------------------------------------------------------------

/**
 * Vendor-agnostic database service interface.
 *
 * Every concrete database engine (Data Connect, Firestore, in-memory mock)
 * implements this contract.  Higher-level layers — repositories, services,
 * controllers — depend on `BaseDatabaseService`, never on a specific SDK.
 *
 * **Coding rules note:** This is the canonical case for `interface` in the
 * Aikami codebase — it defines a polymorphic contract that multiple concrete
 * classes satisfy via `implements`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-interface -- intentional OOP contract
export interface BaseDatabaseService {
  /**
   * Retrieve a single document by its collection-qualified path and unique id.
   *
   * @returns The parsed document, or `undefined` when no document exists at the given path.
   */
  getDocument<T = unknown>(path: string, id: string): Promise<T | undefined>;

  /**
   * Query a collection with optional filters, ordering, and pagination.
   *
   * @returns An array of matching documents (empty array when none match).
   */
  getDocuments<T = unknown>(collection: string, options?: QueryOptions): Promise<T[]>;

  /**
   * Insert a new document into a collection.  The engine assigns the id.
   *
   * @returns The id of the newly created document.
   */
  addDocument<T = unknown>(collection: string, data: T): Promise<string>;

  /**
   * Create or overwrite a document at a specific path + id.
   */
  setDocument<T = unknown>(path: string, id: string, data: T): Promise<void>;

  /**
   * Merge partial data into an existing document.
   */
  updateDocument<T = unknown>(path: string, id: string, data: Partial<T>): Promise<void>;

  /**
   * Remove a document.
   */
  deleteDocument(path: string, id: string): Promise<void>;

  /**
   * Run an arbitrary engine-native query (GraphQL for Data Connect, SQL for
   * PostgreSQL, etc.) and return the raw result rows.
   *
   * **Prefer the typed CRUD methods above for routine operations.**  Use this
   * escape hatch for complex joins, aggregations, or engine-specific features
   * that the generic CRUD surface cannot express.
   *
   * @param query   - Engine-native query string.
   * @param params  - Optional parameter bindings (GraphQL variables, SQL params, etc.).
   * @returns An array of result rows.
   */
  runQuery<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T[]>;
}
