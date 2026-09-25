#!/usr/bin/env bun
// apps/frontend/client/scripts/check_service_worker.ts
//
// Post-build guard: the worker SvelteKit emitted must match how src/app.html
// registers it (see service_worker_registration.ts). Usage:
//   bun scripts/check_service_worker.ts [buildDir]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { logger } from '@aikami/logger';
import { checkServiceWorkerRegistration } from './service_worker_registration.ts';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(CLIENT_DIR, process.argv[2] ?? 'build');
const workerPath = resolve(buildDir, 'service-worker.js');

const html = readFileSync(resolve(CLIENT_DIR, 'src/app.html'), 'utf8');
const workerCode = existsSync(workerPath) ? readFileSync(workerPath, 'utf8') : undefined;
const problem = checkServiceWorkerRegistration(html, workerCode);

if (problem) {
  logger.error(`❌ [check-service-worker] ${problem}`);
  process.exit(1);
}
logger.info('✅ [check-service-worker] service worker registration matches emitted format');
