// apps/frontend/client/src/lib/views/dev/text/text_view_model.test.ts
//
// TextViewModel — completion streaming, cancellation, and structured extraction
// delegation. Constructs the ViewModel through explicit capability fixtures
// with no `$services` barrel mock.
//
// Contract: C-080, C-111, C-320

import { describe, expect, mock, test } from 'bun:test';
import {
  createTextViewModel,
  type TextConfigCapabilities,
  type TextGenerationCapabilities,
} from './text_view_model.svelte.ts';

const createConfig = (): TextConfigCapabilities => ({
  getActiveTextProvider: () => ({ endpoint: 'http://localhost:8080', model: 'test-model' }),
});

const createHarness = (generation: Partial<TextGenerationCapabilities> = {}) => {
  const streamChat = mock(
    async (options: Parameters<TextGenerationCapabilities['streamChat']>[0]) => {
      options.onChunk('Hello');
      options.onChunk(' world');
    },
  );
  const extractStructure = mock(async () => ({ ok: true }));
  const textGeneration = {
    streamChat,
    extractStructure,
    ...generation,
  } satisfies TextGenerationCapabilities;

  const viewModel = createTextViewModel({
    className: 'TextViewModel',
    config: createConfig(),
    textGeneration,
  });

  return { viewModel, streamChat, extractStructure };
};

describe('TextViewModel — completion', () => {
  test('generate streams chunks into output', async () => {
    const { viewModel, streamChat } = createHarness();
    viewModel.prompt = 'say hi';

    await viewModel.generate();

    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(viewModel.output).toBe('Hello world');
    expect(viewModel.isGenerating).toBe(false);
  });

  test('generate skips empty prompts', async () => {
    const { viewModel, streamChat } = createHarness();
    viewModel.prompt = '   ';

    await viewModel.generate();

    expect(streamChat).not.toHaveBeenCalled();
  });

  test('cancel clears the generating flag', () => {
    const { viewModel } = createHarness();
    viewModel.isGenerating = true;
    viewModel.cancel();
    expect(viewModel.isGenerating).toBe(false);
  });
});

describe('TextViewModel — schema validation', () => {
  test('validateSchema parses JSON and delegates extraction', async () => {
    const { viewModel, extractStructure } = createHarness();
    viewModel.schemaDefinition = '{"type":"object"}';
    viewModel.schemaPrompt = 'extract something';

    await viewModel.validateSchema();

    expect(extractStructure).toHaveBeenCalledTimes(1);
    expect(viewModel.schemaResult).toEqual({ ok: true });
  });

  test('validateSchema reports invalid schema JSON', async () => {
    const { viewModel, extractStructure } = createHarness();
    viewModel.schemaDefinition = 'not json';
    viewModel.schemaPrompt = 'extract something';

    await viewModel.validateSchema();

    expect(extractStructure).not.toHaveBeenCalled();
    expect(viewModel.schemaError).toContain('Invalid schema JSON');
  });
});
