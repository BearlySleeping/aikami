import { afterEach, describe, expect, test } from 'bun:test';
import { getVlmConfig } from './ai_vlm_client.ts';

const originalProvider = process.env.VLM_PROVIDER;
const originalModel = process.env.VLM_MODEL;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.VLM_PROVIDER;
  } else {
    process.env.VLM_PROVIDER = originalProvider;
  }
  if (originalModel === undefined) {
    delete process.env.VLM_MODEL;
  } else {
    process.env.VLM_MODEL = originalModel;
  }
});

describe('OpenRouter VLM defaults', () => {
  test('uses Gemini 2.5 Flash when no model override is configured', () => {
    process.env.VLM_PROVIDER = 'openrouter';
    process.env.VLM_MODEL = '';

    expect(getVlmConfig().modelSlug).toBe('google/gemini-2.5-flash');
  });
});
