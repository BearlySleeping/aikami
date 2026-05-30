// packages/backend/database/src/lib/firebase-data-connect-service.ts
import type { BaseDatabaseService, QueryOptions } from './base-database-service';

// ---------------------------------------------------------------------------
// Firebase Data Connect imports (actual SDK surface)
// ---------------------------------------------------------------------------

import { type FirebaseApp, initializeApp } from 'firebase/app';
import {
  type DataConnect,
  connectDataConnectEmulator,
  executeMutation,
  executeQuery,
  getDataConnect,
  mutationRef,
  queryRef,
} from 'firebase/data-connect';

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Connection parameters for Firebase Data Connect.
 */
export type DataConnectConfig = {
  /** Data Connect service id (matches dataconnect.yaml). */
  serviceId: string;
  /** Connector id (matches connector.yaml). */
  connectorId: string;
  /** GCP region where the Data Connect service is deployed. */
  location: string;
  /** Firebase project id. */
  projectId: string;
  /**
   * When `true`, connect to the local emulator instead of the cloud service.
   * The emulator must be running on localhost:9399 (default Data Connect
   * emulator port).
   */
  useEmulator?: boolean;
  /** Emulator host — defaults to 'localhost'. */
  emulatorHost?: string;
  /** Emulator Data Connect port — defaults to 9399. */
  emulatorPort?: number;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * {@link BaseDatabaseService} backed by **Firebase Data Connect** (Cloud SQL
 * for PostgreSQL).
 *
 * Each CRUD method delegates to Data Connect named queries/mutations.  The
 * query names follow the convention `{operation}_{type}` (e.g.
 * `get_user`, `list_users`, `insert_user`, `update_user`, `delete_user`).
 *
 * **Code generation prerequisite:**  The Data Connect SDK requires generated
 * query names.  Run `firebase dataconnect:generate` after schema changes to
 * produce the typed SDK.  Without generated queries, CRUD methods throw an
 * informative error directing the developer to run code generation.
 *
 * **Initialization is lazy** — the connector is created on the first method
 * call to avoid import-time side effects.
 *
 * **Error mapping:**  Raw Data Connect errors are caught and re-thrown as
 * domain `Error` instances.  Callers never see Firebase-internal error shapes.
 */
export class FirebaseDataConnectService implements BaseDatabaseService {
  private connector: DataConnect | undefined;
  private app: FirebaseApp | undefined;
  private readonly config: DataConnectConfig;

  constructor(config: DataConnectConfig) {
    if (!config.serviceId) {
      throw new Error('DataConnectConfig.serviceId is required.');
    }

    if (!config.connectorId) {
      throw new Error('DataConnectConfig.connectorId is required.');
    }

    if (!config.location) {
      throw new Error('DataConnectConfig.location is required.');
    }

    if (!config.projectId) {
      throw new Error('DataConnectConfig.projectId is required.');
    }

    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Ensure the Data Connect connector is initialised.
   *
   * Called lazily by every CRUD method.  Idempotent.
   */
  private ensureInitialized = (): DataConnect => {
    if (this.connector) {
      return this.connector;
    }

    const firebaseConfig = {
      projectId: this.config.projectId,
    };

    this.app = initializeApp(firebaseConfig, 'dataconnect');

    this.connector = getDataConnect(this.app, {
      connectorId: this.config.connectorId,
      location: this.config.location,
      serviceId: this.config.serviceId,
    });

    if (this.config.useEmulator) {
      const host = this.config.emulatorHost ?? 'localhost';
      const port = this.config.emulatorPort ?? 9399;

      connectDataConnectEmulator(this.connector, host, port);
    }

    return this.connector;
  };

  // -----------------------------------------------------------------------
  // BaseDatabaseService implementation
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  getDocument = async <T = unknown>(
    path: string,
    id: string,
  ): Promise<T | undefined> => {
    const dc = this.ensureInitialized();
    const queryName = `Get_${toQuerySuffix(path)}`;

    try {
      const ref = queryRef<{ [key: string]: T | undefined }, { id: string }>(
        dc,
        queryName,
        { id },
      );
      const result = await executeQuery(ref);

      return result.data?.[path] ?? undefined;
    } catch (error) {
      throw toDomainError('getDocument', path, queryName, error);
    }
  };

  /** @inheritdoc */
  getDocuments = async <T = unknown>(
    collection: string,
    options?: QueryOptions,
  ): Promise<T[]> => {
    const dc = this.ensureInitialized();
    const queryName = `List_${toQuerySuffix(collection)}`;

    const variables: Record<string, unknown> = {};

    if (options?.filters && options.filters.length > 0) {
      const first = options.filters[0]!;
      variables[`filter_${first.field.replace(/\./g, '_')}`] = first.value;
    }

    if (options?.limit) {
      variables.limit = options.limit;
    }

    try {
      const ref = queryRef<
        { [key: string]: T[] },
        Record<string, unknown>
      >(dc, queryName, variables);
      const result = await executeQuery(ref);

      return (result.data?.[collection] as T[]) ?? [];
    } catch (error) {
      throw toDomainError('getDocuments', collection, queryName, error);
    }
  };

  /** @inheritdoc */
  addDocument = async <T = unknown>(
    collection: string,
    data: T,
  ): Promise<string> => {
    const dc = this.ensureInitialized();
    const mutationName = `Insert_${toQuerySuffix(collection)}`;

    const fields = { ...(data as Record<string, unknown>) };
    const { id: _id, ...insertData } = fields;
    insertData.createdAt = new Date().toISOString();
    insertData.updatedAt = new Date().toISOString();

    try {
      const ref = mutationRef<
        { [key: string]: { id: string } },
        { data: Record<string, unknown> }
      >(dc, mutationName, { data: insertData });
      const result = await executeMutation(ref);

      return result.data?.[`${collection}_insert`]?.id ?? '';
    } catch (error) {
      throw toDomainError('addDocument', collection, mutationName, error);
    }
  };

  /** @inheritdoc */
  setDocument = async <T = unknown>(
    path: string,
    id: string,
    data: T,
  ): Promise<void> => {
    const dc = this.ensureInitialized();
    const mutationName = `Upsert_${toQuerySuffix(path)}`;

    const fields = { ...(data as Record<string, unknown>), id };

    try {
      const ref = mutationRef<
        unknown,
        { data: Record<string, unknown> }
      >(dc, mutationName, { data: fields });
      await executeMutation(ref);
    } catch (error) {
      throw toDomainError('setDocument', path, mutationName, error);
    }
  };

  /** @inheritdoc */
  updateDocument = async <T = unknown>(
    path: string,
    id: string,
    data: Partial<T>,
  ): Promise<void> => {
    const dc = this.ensureInitialized();
    const mutationName = `Update_${toQuerySuffix(path)}`;

    const { id: _id, createdAt: _ca, ...patch } = data as Record<string, unknown>;
    patch.updatedAt = new Date().toISOString();

    try {
      const ref = mutationRef<
        unknown,
        { id: string; data: Record<string, unknown> }
      >(dc, mutationName, { id, data: patch });
      await executeMutation(ref);
    } catch (error) {
      throw toDomainError('updateDocument', path, mutationName, error);
    }
  };

  /** @inheritdoc */
  deleteDocument = async (path: string, id: string): Promise<void> => {
    const dc = this.ensureInitialized();
    const mutationName = `Delete_${toQuerySuffix(path)}`;

    try {
      const ref = mutationRef<unknown, { id: string }>(
        dc,
        mutationName,
        { id },
      );
      await executeMutation(ref);
    } catch (error) {
      throw toDomainError('deleteDocument', path, mutationName, error);
    }
  };

  /** @inheritdoc */
  runQuery = async <T = unknown>(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> => {
    const dc = this.ensureInitialized();
    // Named query — use the query name directly.
    const queryName = query;

    try {
      const ref = queryRef<Record<string, T[]>, Record<string, unknown>>(
        dc,
        queryName,
        params ?? {},
      );
      const result = await executeQuery(ref);

      if (!result.data) {
        return [];
      }

      const keys = Object.keys(result.data);

      if (keys.length === 0) {
        return [];
      }

      const firstValue = result.data[keys[0]!] as unknown;

      return (Array.isArray(firstValue) ? firstValue : [firstValue]) as T[];
    } catch (error) {
      throw toDomainError('runQuery', queryName, queryName, error);
    }
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a collection/path name to a PascalCase suffix for query naming.
 *
 * @example toQuerySuffix('chat_messages') → 'ChatMessages'
 * @example toQuerySuffix('users') → 'Users'
 */
const toQuerySuffix = (path: string): string => {
  return path
    .split(/[_-]/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
};

/**
 * Translate a Data Connect / network error into a domain Error.
 *
 * Strips Firebase-internal details and provides a context-rich message.
 */
const toDomainError = (
  operation: string,
  collection: string,
  queryName: string,
  raw: unknown,
): Error => {
  const cause =
    raw instanceof Error
      ? raw.message
      : `Unknown Data Connect error during ${operation} on "${collection}".`;

  const prefix = `DataConnect.${operation}("${collection}", query="${queryName}")`;

  if (isMissingQueryError(cause)) {
    return new Error(
      `${prefix}: Named query "${queryName}" was not found. ` +
        `Run \`firebase dataconnect:generate\` to produce the generated SDK, ` +
        `or verify the query name matches the schema.`,
    );
  }

  return new Error(`${prefix}: ${cause}`);
};

/**
 * Heuristic: does the error message indicate a missing/non-existent query?
 */
const isMissingQueryError = (message: string): boolean => {
  return (
    message.includes('not found') ||
    message.includes('No query found') ||
    message.includes('No operation found') ||
    message.includes('Unknown query') ||
    message.includes('Query not found')
  );
};
