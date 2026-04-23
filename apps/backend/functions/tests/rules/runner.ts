/**
 * Firestore Rules Test Runner
 *
 * Syncs latest rules, starts the Firestore emulator, runs rules tests, then shuts down.
 * Usage: bun run tests/rules/runner.ts
 */
import { spawn } from 'child_process';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const EMULATOR_DIR = resolve(import.meta.dir, '../../dist/emulator');
const RULES_SRC = resolve(import.meta.dir, '../../src/rules/firestore.rules');
const RULES_DST = resolve(EMULATOR_DIR, 'firestore.rules');
const FIREBASE_BIN = resolve(
	import.meta.dir,
	'../../../../../node_modules/.bin/firebase',
);

function syncRules(): void {
	if (!existsSync(EMULATOR_DIR)) {
		mkdirSync(EMULATOR_DIR, { recursive: true });
	}
	copyFileSync(RULES_SRC, RULES_DST);
	console.log('📋 Rules synced to emulator directory.');
}

async function waitForEmulatorReady(process: ReturnType<typeof spawn>): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error('Emulator failed to start within 60s'));
		}, 60000);

		const onData = (data: Buffer) => {
			const line = data.toString();
			if (line.includes('All emulators ready') || line.includes('http://localhost:8080')) {
				clearTimeout(timeout);
				process.stdout?.off('data', onData);
				process.stderr?.off('data', onData);
				resolve();
			}
		};

		process.stdout?.on('data', onData);
		process.stderr?.on('data', onData);

		process.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});

		process.on('exit', (code) => {
			if (code !== 0 && code !== null) {
				clearTimeout(timeout);
				reject(new Error(`Emulator exited with code ${code}`));
			}
		});
	});
}

async function runTests(): Promise<number> {
	return new Promise((resolve) => {
		const testProcess = spawn('bun', ['test', 'tests/rules/'], {
			cwd: resolve(import.meta.dir, '../..'),
			stdio: 'inherit',
		});

		testProcess.on('exit', (code) => {
			resolve(code ?? 1);
		});
	});
}

async function main(): Promise<void> {
	syncRules();
	console.log('🔥 Starting Firestore emulator for rules tests...');

	const emulator = spawn(
		FIREBASE_BIN,
		['emulators:start', '--only', 'firestore', '--project', 'aikami-rules-test'],
		{
			cwd: EMULATOR_DIR,
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);

	try {
		await waitForEmulatorReady(emulator);
		console.log('✅ Emulator ready. Running tests...\n');

		const exitCode = await runTests();

		console.log(exitCode === 0 ? '\n✅ All tests passed.' : '\n❌ Some tests failed.');
		process.exit(exitCode);
	} catch (error) {
		console.error('❌ Failed to start emulator:', error);
		emulator.kill('SIGTERM');
		process.exit(1);
	} finally {
		emulator.kill('SIGTERM');
	}
}

main();
