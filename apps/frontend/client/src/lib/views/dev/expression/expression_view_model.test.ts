// apps/frontend/client/src/lib/views/dev/expression/expression_view_model.test.ts
//
// C-239: Expression dev sandbox ViewModel tests.
//
// Exercises the ViewModel through feature-owned capability fixtures — no
// `$services` barrel and no global service-registry mock. Each test constructs
// exactly the capabilities it needs.

import { describe, expect, mock, test } from 'bun:test';
import { BaseDevViewModel } from '@aikami/frontend/services/base';
import type { DetectExpressionResult } from '$types';
import {
  createExpressionDevViewModel,
  type ExpressionAssetCapabilities,
  type ExpressionDetectionCapabilities,
  type ExpressionResolverCapabilities,
} from './expression_view_model.svelte';

// The preload's `window` mock has no `location`, which BaseDevViewModel reads.
const testWindow = globalThis as unknown as {
  window?: { location?: { search: string } };
};
if (testWindow.window && !testWindow.window.location) {
  testWindow.window.location = { search: '' };
}

const createDetection = (
  overrides: Partial<ExpressionDetectionCapabilities> = {},
): ExpressionDetectionCapabilities => ({
  detectExpression: mock(
    async (): Promise<DetectExpressionResult> => ({
      expressionMap: { speaker: 'happy' },
      detectionTier: 'keyword',
    }),
  ),
  ...overrides,
});

const createResolver = (
  overrides: Partial<ExpressionResolverCapabilities> = {},
): ExpressionResolverCapabilities => ({
  resolveLpcOverlays: mock(() => ({ eyes: 'eyes/happy' })),
  ...overrides,
});

const createAssets = (
  overrides: Partial<ExpressionAssetCapabilities> = {},
): ExpressionAssetCapabilities => ({
  manifest: null,
  resolveUrl: mock(() => null),
  ...overrides,
});

const createViewModel = (
  options: {
    expression?: ExpressionDetectionCapabilities;
    resolver?: ExpressionResolverCapabilities;
    assets?: ExpressionAssetCapabilities;
  } = {},
) =>
  createExpressionDevViewModel({
    className: 'ExpressionDevViewModel',
    expression: options.expression ?? createDetection(),
    resolver: options.resolver ?? createResolver(),
    assets: options.assets ?? createAssets(),
  });

describe('ExpressionDevViewModel — initial state', () => {
  test('starts with neutral defaults', () => {
    const viewModel = createViewModel();

    expect(viewModel.inputText).toBe('');
    expect(viewModel.isDetecting).toBe(false);
    expect(viewModel.detectionResult).toBeUndefined();
    expect(viewModel.useAgent).toBe(true);
    expect(viewModel.selectedExpressionId).toBe('neutral');
    expect(viewModel.characterNames).toBe('');
  });

  test('extends the production BaseDevViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseDevViewModel);
  });

  test('exposes the expression catalog entries', () => {
    const viewModel = createViewModel();

    expect(viewModel.catalogEntries.length).toBeGreaterThan(0);
    expect(viewModel.catalogEntries[0]?.id).toBe('neutral');
  });
});

describe('ExpressionDevViewModel — detection', () => {
  test('setInputText runs detection and stores the result', async () => {
    const detectExpression = mock(
      async (): Promise<DetectExpressionResult> => ({
        expressionMap: { speaker: 'angry' },
        detectionTier: 'agent',
      }),
    );
    const viewModel = createViewModel({ expression: createDetection({ detectExpression }) });

    viewModel.setInputText('I am furious');
    await Promise.resolve();

    expect(detectExpression).toHaveBeenCalledWith({
      message: 'I am furious',
      characters: undefined,
      useAgent: true,
    });
    expect(viewModel.detectionResult?.expressionMap).toEqual({ speaker: 'angry' });
    expect(viewModel.isDetecting).toBe(false);
  });

  test('clearing the text resets the result without detecting', async () => {
    const detectExpression = mock(
      async (): Promise<DetectExpressionResult> => ({
        expressionMap: {},
        detectionTier: 'keyword',
      }),
    );
    const viewModel = createViewModel({ expression: createDetection({ detectExpression }) });

    viewModel.setInputText('   ');
    await Promise.resolve();

    expect(detectExpression).not.toHaveBeenCalled();
    expect(viewModel.detectionResult).toBeUndefined();
  });

  test('characterNames scope the detection request', async () => {
    const detectExpression = mock(
      async (): Promise<DetectExpressionResult> => ({
        expressionMap: {},
        detectionTier: 'keyword',
      }),
    );
    const viewModel = createViewModel({ expression: createDetection({ detectExpression }) });

    viewModel.setInputText('Hello');
    viewModel.setCharacterNames('Alice, Bob');
    await Promise.resolve();

    expect(detectExpression).toHaveBeenLastCalledWith({
      message: 'Hello',
      characters: ['Alice', 'Bob'],
      useAgent: true,
    });
  });

  test('toggleAgent flips the flag and re-runs detection', async () => {
    const detectExpression = mock(
      async (): Promise<DetectExpressionResult> => ({
        expressionMap: {},
        detectionTier: 'keyword',
      }),
    );
    const viewModel = createViewModel({ expression: createDetection({ detectExpression }) });
    viewModel.setInputText('Hello');
    await Promise.resolve();

    viewModel.toggleAgent();
    await Promise.resolve();

    expect(viewModel.useAgent).toBe(false);
    expect(detectExpression).toHaveBeenLastCalledWith({
      message: 'Hello',
      characters: undefined,
      useAgent: false,
    });
  });
});

describe('ExpressionDevViewModel — preview capabilities', () => {
  test('selectedOverlays delegates to the resolver', () => {
    const resolveLpcOverlays = mock(() => ({ mouth: 'mouth/smile' }));
    const viewModel = createViewModel({ resolver: createResolver({ resolveLpcOverlays }) });

    viewModel.selectExpression('happy');

    expect(viewModel.selectedExpressionId).toBe('happy');
    expect(viewModel.selectedOverlays).toEqual({ mouth: 'mouth/smile' });
    expect(resolveLpcOverlays).toHaveBeenCalledWith('happy');
  });

  test('portraitBaseUrl is empty without a manifest', () => {
    const resolveUrl = mock(() => 'http://localhost/portrait.png');
    const viewModel = createViewModel({ assets: createAssets({ manifest: null, resolveUrl }) });

    expect(viewModel.portraitBaseUrl).toBe('');
    expect(resolveUrl).not.toHaveBeenCalled();
  });

  test('portraitBaseUrl resolves through the asset store when loaded', () => {
    const resolveUrl = mock(() => 'http://localhost/portrait.png');
    const viewModel = createViewModel({
      assets: createAssets({ manifest: {} as never, resolveUrl }),
    });

    expect(viewModel.portraitBaseUrl).toBe('http://localhost/portrait.png');
    expect(resolveUrl).toHaveBeenCalledWith('sprites:combat:player_portrait');
  });
});
