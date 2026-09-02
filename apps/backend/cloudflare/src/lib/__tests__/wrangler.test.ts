// apps/backend/cloudflare/src/lib/__tests__/wrangler.test.ts
//
// C-455 AC-4: Non-local destructive commands without an explicit --mode are refused.

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';

// Save original env
const ORIGINAL_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// We need to use dynamic imports to test checkLocalMode with different env
describe('resolveModeGuard (AC-4)', () => {
	beforeEach(() => {
		delete process.env.CLOUDFLARE_API_TOKEN;
	});

	afterEach(() => {
		process.env.CLOUDFLARE_API_TOKEN = ORIGINAL_TOKEN;
	});

	test('--local returns emulator mode with isLocal=true', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		const result = resolveModeGuard(['--local']);
		expect(result.mode).toBe('emulator');
		expect(result.isLocal).toBe(true);
	});

	test('--remote without --mode throws', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		expect(() => resolveModeGuard(['--remote'])).toThrow(
			'--mode staging|production is required for a non-local run.',
		);
	});

	test('--remote --mode staging returns staging mode', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		const result = resolveModeGuard(['--remote', '--mode', 'staging']);
		expect(result.mode).toBe('staging');
		expect(result.isLocal).toBe(false);
	});

	test('--remote --mode production returns production mode', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		const result = resolveModeGuard(['--remote', '--mode', 'production']);
		expect(result.mode).toBe('production');
		expect(result.isLocal).toBe(false);
	});

	test('--mode staging without --remote defaults to local (must explicitly say --remote)', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		const result = resolveModeGuard(['--mode', 'staging']);
		expect(result.mode).toBe('emulator');
		expect(result.isLocal).toBe(true);
	});

	test('no flags at all defaults to local mode', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		const result = resolveModeGuard([]);
		expect(result.mode).toBe('emulator');
		expect(result.isLocal).toBe(true);
	});

	test('--mode invalid without --remote defaults to local', async () => {
		const { resolveModeGuard } = await import('../wrangler.ts');
		const result = resolveModeGuard(['--mode', 'invalid']);
		expect(result.mode).toBe('emulator');
		expect(result.isLocal).toBe(true);
	});
});

describe('checkLocalMode (AC-4)', () => {
	const ORIG = process.env.CLOUDFLARE_API_TOKEN;

	afterEach(() => {
		process.env.CLOUDFLARE_API_TOKEN = ORIG;
	});

	test('refuses when CLOUDFLARE_API_TOKEN is set', async () => {
		process.env.CLOUDFLARE_API_TOKEN = 'some-token';

		const origExit = process.exit;
		const exitMock = mock((code?: number) => {
			throw new Error(`process.exit(${code})`);
		});
		process.exit = exitMock as unknown as typeof process.exit;

		try {
			const { checkLocalMode } = await import('../wrangler.ts');
			expect(() => checkLocalMode()).toThrow('process.exit(1)');
		} finally {
			process.exit = origExit;
		}
	});

	test('proceeds when CLOUDFLARE_API_TOKEN is not set', async () => {
		delete process.env.CLOUDFLARE_API_TOKEN;

		const { checkLocalMode } = await import('../wrangler.ts');
		expect(() => checkLocalMode()).not.toThrow();
	});
});
