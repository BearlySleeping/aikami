// scripts/src/lib/ops/emberwatch_studio.test.ts

import { describe, expect, test } from 'bun:test';
import { parseStudioPort, planStudioLaunch } from './emberwatch_studio.ts';

const DEFAULT_PORT = 8788;

describe('parseStudioPort', () => {
  test('accepts finite integer TCP ports', () => {
    expect(parseStudioPort(['--port', '4321'])).toBe(4321);
    expect(parseStudioPort(['--port', '1'])).toBe(1);
    expect(parseStudioPort(['--port', '65535'])).toBe(65_535);
  });

  test('falls back for a missing --port value', () => {
    expect(parseStudioPort([])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--watch', '--port'])).toBe(DEFAULT_PORT);
  });

  test('falls back for malformed, fractional, or out-of-range values', () => {
    expect(parseStudioPort(['--port', 'NaN'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port', 'abc'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port', '12.5'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port', '0'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port', '-1'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port', '65536'])).toBe(DEFAULT_PORT);
    expect(parseStudioPort(['--port', 'Infinity'])).toBe(DEFAULT_PORT);
  });
});

describe('planStudioLaunch', () => {
  const env = { PUBLIC_ASSETS_BASE_URL: 'https://assets.example.test' };

  test('starts both services and points the client at the local origin', () => {
    const plan = planStudioLaunch({ args: [], snapshotExists: true, env });
    expect(plan.startOrigin).toBe(true);
    expect(plan.startClient).toBe(true);
    expect(plan.originPort).toBe(DEFAULT_PORT);
    expect(plan.overrideAssetOrigin).toBe(true);
    expect(plan.clientEnv.PUBLIC_ASSETS_BASE_URL).toBe(`http://localhost:${DEFAULT_PORT}`);
  });

  test('--no-serve preserves the configured asset origin', () => {
    const plan = planStudioLaunch({ args: ['--no-serve'], snapshotExists: true, env });
    expect(plan.startOrigin).toBe(false);
    expect(plan.overrideAssetOrigin).toBe(false);
    expect(plan.clientEnv.PUBLIC_ASSETS_BASE_URL).toBe('https://assets.example.test');
  });

  test('a missing snapshot preserves the configured asset origin', () => {
    const plan = planStudioLaunch({ args: [], snapshotExists: false, env });
    expect(plan.startOrigin).toBe(false);
    expect(plan.overrideAssetOrigin).toBe(false);
    expect(plan.clientEnv.PUBLIC_ASSETS_BASE_URL).toBe('https://assets.example.test');
  });

  test('--no-client still plans the origin', () => {
    const plan = planStudioLaunch({ args: ['--no-client'], snapshotExists: true, env });
    expect(plan.startOrigin).toBe(true);
    expect(plan.startClient).toBe(false);
  });

  test('honors an explicit --port in the client asset origin', () => {
    const plan = planStudioLaunch({ args: ['--port', '9000'], snapshotExists: true, env });
    expect(plan.originPort).toBe(9000);
    expect(plan.clientEnv.PUBLIC_ASSETS_BASE_URL).toBe('http://localhost:9000');
  });
});
