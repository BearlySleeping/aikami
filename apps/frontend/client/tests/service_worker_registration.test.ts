// apps/frontend/client/tests/service_worker_registration.test.ts
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkServiceWorkerRegistration,
  findRegistrationType,
} from '../scripts/service_worker_registration.ts';

const MODULE_WORKER = 'import "/_app/env.js";\nself.addEventListener("fetch", () => {});';
const CLASSIC_WORKER = 'self.addEventListener("fetch", () => {});';
const register = (options: string): string =>
  `navigator.serviceWorker.register('/service-worker.js'${options}).catch(() => {});`;

describe('service worker registration guard', () => {
  it('registers the worker as a module in the real app shell', () => {
    const html = readFileSync(resolve(import.meta.dir, '../src/app.html'), 'utf8');
    expect(findRegistrationType(html)).toBe('module');
  });

  it('rejects a classic registration of a module worker', () => {
    expect(checkServiceWorkerRegistration(register(", { scope: '/' }"), MODULE_WORKER)).toContain(
      "type: 'module'",
    );
  });

  it('accepts a module registration of a module worker', () => {
    const html = register(", { scope: '/', type: 'module' }");
    expect(checkServiceWorkerRegistration(html, MODULE_WORKER)).toBeUndefined();
  });

  it('accepts a classic registration of a classic worker', () => {
    expect(checkServiceWorkerRegistration(register(''), CLASSIC_WORKER)).toBeUndefined();
  });

  it('rejects a registration with no emitted worker', () => {
    expect(checkServiceWorkerRegistration(register(''), undefined)).toBeDefined();
  });
});
