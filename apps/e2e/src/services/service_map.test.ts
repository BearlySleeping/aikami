// apps/e2e/src/services/service_map.test.ts
// Unit tests for the preflight's service catalog and project→services map.

import { beforeEach, expect, test } from 'bun:test';

import {
  defaultProjectSelection,
  FALLBACK_BUILD_ENV,
  resolveRequiredServices,
  SERVICE_DEFS,
} from './service_map';

beforeEach(() => {
  // The conditional projects' flags influence the default selection — start
  // every test from a clean env.
  delete process.env.E2E_LLM_LANE;
  delete process.env.TEST_WEBGPU;
});

test('game needs only the client (offline-first, no setup dependency)', () => {
  expect(resolveRequiredServices(['game'])).toEqual(['client']);
});

test('client lanes bring the hub via the setup dependency', () => {
  for (const name of ['client', 'client-offline', 'client-keyboard', 'client-webgpu']) {
    expect(resolveRequiredServices([name])).toEqual(['client', 'hub']);
  }
  expect(resolveRequiredServices(['setup'])).toEqual(['client', 'hub']);
});

test('client-llm-on needs both client servers plus the hub', () => {
  expect(resolveRequiredServices(['client-llm-on'])).toEqual(['client', 'client-llm', 'hub']);
});

test('site projects need only the site server', () => {
  for (const name of ['site-chromium', 'site-mobile', 'site-firefox']) {
    expect(resolveRequiredServices([name])).toEqual(['site']);
  }
});

test('hub needs only the hub server', () => {
  expect(resolveRequiredServices(['hub'])).toEqual(['hub']);
});

test('ai-services has no tests yet, so it needs no servers', () => {
  expect(SERVICE_DEFS).toBeDefined();
  expect(resolveRequiredServices(['ai-services'])).toEqual([]);
});

test('unions across a multi-project selection', () => {
  expect(resolveRequiredServices(['game', 'site-chromium', 'hub'])).toEqual([
    'client',
    'site',
    'hub',
  ]);
});

test('unknown project names require no services', () => {
  expect(resolveRequiredServices(['no-such-project'])).toEqual([]);
  expect(resolveRequiredServices(['game', 'no-such-project'])).toEqual(['client']);
});

test('default selection omits the enabled-agent lane unless flagged', () => {
  const all = resolveRequiredServices(undefined);
  expect(all).toContain('client');
  expect(all).toContain('site');
  expect(all).toContain('hub');
  expect(all).not.toContain('client-llm');

  process.env.E2E_LLM_LANE = '1';
  expect(resolveRequiredServices(undefined)).toContain('client-llm');
});

test('default selection includes webgpu only when opted in', () => {
  expect(defaultProjectSelection()).not.toContain('client-webgpu');
  process.env.TEST_WEBGPU = 'true';
  expect(defaultProjectSelection()).toContain('client-webgpu');
});

test('service defs sit on the documented emulator ports', () => {
  expect(SERVICE_DEFS.client.port).toBe(5274);
  expect(SERVICE_DEFS['client-llm'].port).toBe(5275);
  expect(SERVICE_DEFS.hub.port).toBe(5276);
  expect(SERVICE_DEFS.site.port).toBe(5280);
  expect(SERVICE_DEFS.client.baseUrl).toBe('http://localhost:5274');
});

test('client-llm is a dev-server-only lane that must never be built', () => {
  const def = SERVICE_DEFS['client-llm'];
  expect(def.herdrService).toBeUndefined();
  expect(def.servesBuild).toBe(false);
  expect(def.buildTasks).toEqual([]);
  expect(def.serve.env.PUBLIC_COMBAT_LLM_AGENTS).toBe('1');
  expect(def.serve.env.PUBLIC_MODE).toBe('emulator');
});

test('site serves built output and is built from site:build', () => {
  const def = SERVICE_DEFS.site;
  expect(def.servesBuild).toBe(true);
  expect(def.buildTasks).toEqual(['site:build']);
  expect(def.serve).toMatchObject({ command: 'bun', args: ['run', 'preview'] });
});

test('fallback build env matches the pr-checks recipe', () => {
  expect(FALLBACK_BUILD_ENV).toEqual({
    PUBLIC_APP_ID: 'site',
    PUBLIC_MODE: 'development',
  });
});
