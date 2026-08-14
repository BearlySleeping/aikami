import { afterEach, describe, expect, test } from 'bun:test';
import { isEnabled, isPipelineWorker } from './gating.ts';

const ENV_KEYS = ['PI_TOOLS_ON', 'PI_TOOLS_OFF', 'CONTRACT_PIPELINE_ROLE'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe('isPipelineWorker', () => {
  test('false when the role env is absent', () => {
    expect(isPipelineWorker()).toBe(false);
  });

  test('false when the role env is empty', () => {
    process.env.CONTRACT_PIPELINE_ROLE = '';
    expect(isPipelineWorker()).toBe(false);
  });

  test('true when a role is set', () => {
    process.env.CONTRACT_PIPELINE_ROLE = 'implementer';
    expect(isPipelineWorker()).toBe(true);
  });
});

describe('isEnabled', () => {
  test('follows the default when no env overrides are set', () => {
    expect(isEnabled('browser')).toBe(true);
    expect(isEnabled('contract_stage', false)).toBe(false);
  });

  test('PI_TOOLS_OFF disables a default-on extension', () => {
    process.env.PI_TOOLS_OFF = 'browser,firebase';
    expect(isEnabled('browser')).toBe(false);
    expect(isEnabled('firebase')).toBe(false);
    expect(isEnabled('direnv')).toBe(true);
  });

  test('PI_TOOLS_ON enables a default-off extension', () => {
    process.env.PI_TOOLS_ON = 'contract_stage';
    expect(isEnabled('contract_stage', false)).toBe(true);
  });

  test('an explicit ON beats an explicit OFF', () => {
    process.env.PI_TOOLS_OFF = 'browser';
    process.env.PI_TOOLS_ON = 'browser';
    expect(isEnabled('browser')).toBe(true);
  });

  test('matching is case-insensitive and tolerates spacing', () => {
    process.env.PI_TOOLS_OFF = ' Browser ,  FIREBASE ';
    expect(isEnabled('browser')).toBe(false);
    expect(isEnabled('firebase')).toBe(false);
  });

  test('accepts a space-separated list', () => {
    process.env.PI_TOOLS_OFF = 'browser firebase';
    expect(isEnabled('browser')).toBe(false);
    expect(isEnabled('firebase')).toBe(false);
  });

  test('an empty env list disables nothing', () => {
    process.env.PI_TOOLS_OFF = '';
    expect(isEnabled('browser')).toBe(true);
  });
});
