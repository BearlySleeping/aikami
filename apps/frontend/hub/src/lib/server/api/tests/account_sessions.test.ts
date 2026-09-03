// apps/frontend/hub/src/lib/server/api/tests/account_sessions.test.ts
//
// C-464 AC-10: Revoke-all-sessions through Better Auth's session API.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare D1 binding name is SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

// Mock better_auth before importing the module under test
mock.module('../better_auth.ts', () => ({
	getBetterAuth: () => undefined,
}));
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';

mock.module('$env/dynamic/private', () => ({
	env: {
		BETTER_AUTH_URL: 'http://localhost:5173',
		BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
	} as Record<string, string | undefined>,
}));

const BASE_URL = 'http://localhost:5173';

let client: Client;

const createMockD1 = (dbClient: Client) => {
	const prepareStatement = (sql: string) => ({
		bind: (...params: never[]) => ({
			all: async () => {
				const res = await dbClient.execute({ sql, args: params as never[] });
				return { results: res.rows };
			},
			first: async () => {
				const res = await dbClient.execute({ sql, args: params as never[] });
				return res.rows[0] ?? null;
			},
			run: async () => {
				const _res = await dbClient.execute({ sql, args: params as never[] });
				return { meta: { last_row_id: 0, changes: 0 } };
			},
			raw: async () => {
				const res = await dbClient.execute({ sql, args: params as never[] });
				return res.rows;
			},
		}),
	});
	return {
		binding: {
			prepare: prepareStatement,
			exec: async (sql: string) => {
				await dbClient.execute(sql);
			},
			batch: async (statements: Array<{ sql: string; params?: unknown[] }>) =>
				Promise.all(
					statements.map((s) =>
						dbClient.execute({ sql: s.sql, args: (s.params ?? []) as never[] }),
					),
				),
		},
	};
};

const applyD1Migrations = async (): Promise<void> => {
	const dir = join(
		import.meta.dir,
		'..',
		'..',
		'..',
		'..',
		'..',
		'..',
		'..',
		'..',
		'packages',
		'backend',
		'database',
		'drizzle-d1',
	);
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(dir, file), 'utf8');
		for (const statement of sql.split('--> statement-breakpoint')) {
			const trimmed = statement.trim();
			if (trimmed) {
				await client.execute(trimmed);
			}
		}
	}
};

beforeAll(async () => {
	client = createClient({ url: ':memory:' });
	await applyD1Migrations();
});

afterAll(() => {
	client.close();
});

describe('POST /api/account/sessions/revoke-all — AC-10', () => {
	test('returns 503 when Better Auth is not configured (no env injected)', async () => {
		const { handleRevokeAllSessions } = await import('../account_sessions.ts');

		const request = new Request(`${BASE_URL}/api/account/sessions/revoke-all`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
		});
		const response = await handleRevokeAllSessions(request);
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.error).toBe('auth_unconfigured');
	});
});
