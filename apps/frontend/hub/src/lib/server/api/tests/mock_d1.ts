// apps/frontend/hub/src/lib/server/api/tests/mock_d1.ts
/** biome-ignore-all lint/style/useNamingConvention: Cloudflare D1 metadata uses snake_case */

import type { D1Result } from '@cloudflare/workers-types';
import type { Client, InValue } from '@libsql/client';

type MockQueryResult = {
  readonly rows: Array<Record<string, unknown>>;
  readonly rowsAffected?: number;
  readonly lastInsertRowid?: bigint;
};

type BoundQuery = {
  readonly sql: string;
  readonly args: InValue[];
};

type MockD1Result = D1Result<Record<string, unknown>>;

const BOUND_QUERY = Symbol('bound-query');

type MockD1PreparedStatement = {
  bind(...values: InValue[]): MockD1PreparedStatement;
  all(): Promise<MockD1Result>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<MockD1Result>;
  raw(): Promise<unknown[][]>;
  [BOUND_QUERY](): BoundQuery;
};

type CreateMockD1Options = {
  execute(query: BoundQuery): Promise<MockQueryResult>;
  batch?(queries: BoundQuery[]): Promise<MockQueryResult[]>;
};

const toD1Result = (result: MockQueryResult): MockD1Result => {
  const rowsAffected = result.rowsAffected ?? 0;
  return {
    success: true,
    results: result.rows,
    meta: {
      changed_db: rowsAffected > 0,
      changes: rowsAffected,
      duration: 0,
      last_row_id: Number(result.lastInsertRowid ?? 0),
      rows_read: result.rows.length,
      rows_written: rowsAffected,
      size_after: 0,
    },
  };
};

/** Creates a D1-shaped test adapter from a narrow query executor. */
export const createMockD1 = (options: CreateMockD1Options) => {
  const prepareStatement = (sql: string, args: InValue[] = []): MockD1PreparedStatement => ({
    bind: (...values: InValue[]) => prepareStatement(sql, values),
    all: async () => toD1Result(await options.execute({ sql, args })),
    first: async () => (await options.execute({ sql, args })).rows[0] ?? null,
    run: async () => toD1Result(await options.execute({ sql, args })),
    raw: async () => {
      const result = await options.execute({ sql, args });
      return result.rows.map((row) => Object.values(row));
    },
    [BOUND_QUERY]: () => ({ sql, args }),
  });

  return {
    prepare: (sql: string) => prepareStatement(sql),
    exec: async (sql: string) => {
      const startedAt = performance.now();
      await options.execute({ sql, args: [] });
      return { count: 1, duration: performance.now() - startedAt };
    },
    batch: async (statements: MockD1PreparedStatement[]) => {
      const queries = statements.map((statement) => statement[BOUND_QUERY]());
      const results = options.batch
        ? await options.batch(queries)
        : await queries.reduce<Promise<MockQueryResult[]>>(async (pending, query) => {
            const orderedResults = await pending;
            orderedResults.push(await options.execute(query));
            return orderedResults;
          }, Promise.resolve([]));
      return results.map(toD1Result);
    },
  };
};

/** Creates a D1-shaped adapter backed by an in-memory libSQL client. */
export const createLibsqlMockD1 = (dbClient: Client) =>
  createMockD1({
    execute: async ({ sql, args }) => dbClient.execute({ sql, args }),
    batch: async (queries) => dbClient.batch(queries, 'write'),
  });
