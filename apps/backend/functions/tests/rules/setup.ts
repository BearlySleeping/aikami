import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const RULES_PATH = resolve(import.meta.dir, '../../src/rules/firestore.rules');
const PROJECT_ID = 'aikami-rules-test';

let testEnvironment: RulesTestEnvironment | undefined;

export async function getTestEnvironment(): Promise<RulesTestEnvironment> {
	if (testEnvironment) {
		return testEnvironment;
	}

	const rules = readFileSync(RULES_PATH, 'utf-8');

	testEnvironment = await initializeTestEnvironment({
		projectId: PROJECT_ID,
		firestore: {
			rules,
			host: 'localhost',
			port: 8080,
		},
	});

	return testEnvironment;
}

export async function cleanupTestEnvironment(): Promise<void> {
	if (testEnvironment) {
		await testEnvironment.cleanup();
		testEnvironment = undefined;
	}
}
