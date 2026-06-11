// apps/frontend/client/src/lib/views/dev/image/image_view_model.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock imageGenerationService before importing the ViewModel
// ---------------------------------------------------------------------------

let mockCheckpoints: Array<{ id: string; description: string }> = [];
let mockSelectedCheckpoint = '';
let mockGenerateImageCalls: Array<{ prompt: string; checkpoint?: string }> = [];
let loadCheckpointsCalled = false;

mock.module('$services', () => {
  return {
    imageGenerationService: {
      get checkpoints() {
        return mockCheckpoints;
      },
      get selectedCheckpoint(): string {
        return mockSelectedCheckpoint;
      },
      set selectedCheckpoint(value: string) {
        mockSelectedCheckpoint = value;
      },
      loadCheckpoints: mock(async (): Promise<void> => {
        loadCheckpointsCalled = true;
        mockCheckpoints = [
          { id: 'sd_xl_base_1.0', description: 'SDXL Base 1.0' },
          { id: 'sd_xl_turbo', description: 'SDXL Turbo' },
        ];
        if (!mockSelectedCheckpoint) {
          mockSelectedCheckpoint = 'sd_xl_base_1.0';
        }
      }),
      generateImage: mock(
        async (options: {
          prompt: string;
          checkpoint?: string;
        }): Promise<{ url: string; isDemo: boolean }> => {
          mockGenerateImageCalls.push(options);
          return { url: 'https://example.com/img.png', isDemo: true };
        },
      ),
      isDemoMode: mock((): boolean => true),
    },
    __esModule: true,
  };
});

import type { ImageViewModelInterface } from './image_view_model.svelte.ts';

const getImageViewModel = async (): Promise<ImageViewModelInterface> => {
  const mod = await import('./image_view_model.svelte.ts');
  return mod.getImageViewModel({ className: 'ImageViewModel' });
};

describe('ImageViewModel — C-076 Checkpoints', () => {
  beforeEach(() => {
    mockCheckpoints = [];
    mockSelectedCheckpoint = '';
    mockGenerateImageCalls = [];
    loadCheckpointsCalled = false;
  });

  // ── AC-2: ViewModel Bridging & Initialization ─────────────────────────

  describe('AC-2: checkpoint bridging', () => {
    test('getImageViewModel should return a ViewModel instance', async () => {
      const viewModel = await getImageViewModel();
      expect(viewModel).toBeDefined();
      expect(viewModel.prompt).toBe('');
    });

    test('checkpoints getter should return empty array before load', async () => {
      const viewModel = await getImageViewModel();
      expect(viewModel.checkpoints).toEqual([]);
    });

    test('initialize should call loadCheckpoints and populate checkpoints', async () => {
      const viewModel = await getImageViewModel();
      expect(viewModel.checkpoints).toEqual([]);

      await viewModel.initialize();

      expect(loadCheckpointsCalled).toBe(true);
      expect(viewModel.checkpoints.length).toBe(2);
      expect(viewModel.checkpoints[0].id).toBe('sd_xl_base_1.0');
    });

    test('initialize should set default selectedCheckpoint when none is set', async () => {
      const viewModel = await getImageViewModel();
      await viewModel.initialize();

      expect(viewModel.selectedCheckpoint).toBe('sd_xl_base_1.0');
    });

    test('selectedCheckpoint getter should proxy to service', async () => {
      const viewModel = await getImageViewModel();
      mockSelectedCheckpoint = 'sd_xl_turbo';

      expect(viewModel.selectedCheckpoint).toBe('sd_xl_turbo');
    });

    test('selectedCheckpoint setter should proxy to service', async () => {
      const viewModel = await getImageViewModel();
      viewModel.selectedCheckpoint = 'dreamshaper_xl';

      expect(mockSelectedCheckpoint).toBe('dreamshaper_xl');
      expect(viewModel.selectedCheckpoint).toBe('dreamshaper_xl');
    });
  });

  // ── AC-4: Generation Payload Inclusion (via ViewModel) ────────────────

  describe('AC-4: generate passes checkpoint via ViewModel', () => {
    test('generate should call service.generateImage with prompt', async () => {
      const viewModel = await getImageViewModel();
      viewModel.prompt = 'a dragon';

      await viewModel.generate();

      expect(mockGenerateImageCalls.length).toBe(1);
      expect(mockGenerateImageCalls[0].prompt).toBe('a dragon');
    });

    test('generate should set isGenerating to true during generation', async () => {
      const viewModel = await getImageViewModel();
      viewModel.prompt = 'a dragon';

      expect(viewModel.isGenerating).toBe(false);

      const generatePromise = viewModel.generate();
      expect(viewModel.isGenerating).toBe(true);

      await generatePromise;
      expect(viewModel.isGenerating).toBe(false);
    });

    test('generate should set imageUrl from service result', async () => {
      const viewModel = await getImageViewModel();
      viewModel.prompt = 'a dragon';

      expect(viewModel.imageUrl).toBeUndefined();

      await viewModel.generate();

      expect(viewModel.imageUrl).toBe('https://example.com/img.png');
    });

    test('generate should not call service when prompt is empty', async () => {
      const viewModel = await getImageViewModel();
      viewModel.prompt = '  ';

      await viewModel.generate();

      expect(mockGenerateImageCalls.length).toBe(0);
      expect(viewModel.isGenerating).toBe(false);
    });

    test('cancel should set isGenerating to false', async () => {
      const viewModel = await getImageViewModel();

      // Artificially set isGenerating (simulating mid-generation)
      viewModel.isGenerating = true;
      expect(viewModel.isGenerating).toBe(true);

      viewModel.cancel();

      expect(viewModel.isGenerating).toBe(false);
    });
  });
});
