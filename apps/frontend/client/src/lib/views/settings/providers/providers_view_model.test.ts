// apps/frontend/client/src/lib/views/settings/providers/providers_view_model.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock configService
// ---------------------------------------------------------------------------

let mockConfigState: Record<string, unknown> = {};
let mockIsLoaded = false;
let loadCalls = 0;
let saveCalls = 0;
let resetCalls = 0;

const CONFIG_SERVICE_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/config/config_service.svelte.ts';

const getDefaultConfig = () => ({
  apiKeys: {},
  image: {
    backend: 'comfyui',
    cfgScale: 7.5,
    checkpoint: 'sd_xl_base_1.0',
    height: 1024,
    steps: 30,
    width: 1024,
  },
  memory: {
    contextWindow: 8192,
    longTermMemory: false,
    maxTurns: 50,
    summarizationThreshold: 20,
  },
  models: [],
  preferredModel: '',
  voice: {
    engine: 'kokoro',
    pitch: 0,
    speed: 1.0,
    voiceId: 'af_heart',
  },
});

mock.module(CONFIG_SERVICE_PATH, () => ({
  configService: {
    get state() {
      return mockConfigState;
    },
    get isLoaded() {
      return mockIsLoaded;
    },
    load: mock(async (): Promise<void> => {
      loadCalls++;
      mockConfigState = { ...getDefaultConfig(), ...(mockConfigState as object) };
      mockIsLoaded = true;
    }),
    save: mock(async (): Promise<void> => {
      saveCalls++;
    }),
    reset: mock(async (): Promise<void> => {
      resetCalls++;
      mockConfigState = getDefaultConfig();
      mockIsLoaded = false;
    }),
    setApiKeys: mock(() => {}),
    setPreferredModel: mock(() => {}),
    setModels: mock(() => {}),
    updateModel: mock(() => {}),
    setMemoryConfig: mock(() => {}),
    setVoiceConfig: mock(() => {}),
    setImageConfig: mock(() => {}),
  },
  ConfigService: class {},
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Mock LocalServiceDetector
// ---------------------------------------------------------------------------

let mockServiceStatus: Record<string, string> = {
  comfyUi: 'disconnected',
  voice: 'disconnected',
  text: 'disconnected',
};

let detectAllCalls = 0;
let detectServiceCalls: string[] = [];

const DETECTOR_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/config/local_service_detector.svelte';

mock.module(DETECTOR_PATH, () => ({
  LocalServiceDetector: class {
    status = mockServiceStatus;
    async detectAll() {
      detectAllCalls++;
      mockServiceStatus = { ...mockServiceStatus };
      return { ...mockServiceStatus };
    }
    async detectService(key: string) {
      detectServiceCalls.push(key);
      return mockServiceStatus[key] ?? 'disconnected';
    }
  },
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

import type { ConfigTab, ProvidersViewModelInterface } from './providers_view_model.svelte.ts';

const getViewModel = async (): Promise<ProvidersViewModelInterface> => {
  const mod = await import('./providers_view_model.svelte.ts');
  return mod.getProvidersViewModel({ className: 'ProvidersViewModel' });
};

// ---------------------------------------------------------------------------
// Tests: C-079 — ConfigViewModel
// ---------------------------------------------------------------------------

describe('ProvidersViewModel — C-079', () => {
  beforeEach(() => {
    mockConfigState = getDefaultConfig();
    mockIsLoaded = false;
    loadCalls = 0;
    saveCalls = 0;
    resetCalls = 0;
    mockServiceStatus = {
      comfyUi: 'disconnected',
      text: 'disconnected',
      voice: 'disconnected',
    };
    detectAllCalls = 0;
    detectServiceCalls = [];
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-1: Tabbed Configuration Layout
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-1: Tab navigation', () => {
    test('should initialize with api-keys as active tab', async () => {
      const vm = await getViewModel();
      expect(vm.activeTab).toBe('api-keys');
    });

    test('should have 5 tabs defined', async () => {
      const vm = await getViewModel();
      expect(vm.tabs.length).toBe(5);
    });

    test('should have correct tab labels', async () => {
      const vm = await getViewModel();
      const labels = vm.tabs.map((t) => t.label);
      expect(labels).toContain('API Keys');
      expect(labels).toContain('Models');
      expect(labels).toContain('Voice');
      expect(labels).toContain('Image');
      expect(labels).toContain('Memory');
    });

    test('setActiveTab should change active tab', async () => {
      const vm = await getViewModel();
      vm.setActiveTab('voice');
      expect(vm.activeTab).toBe('voice');
    });

    test('setActiveTab should accept all valid tabs', async () => {
      const vm = await getViewModel();
      const tabs: ConfigTab[] = ['api-keys', 'models', 'voice', 'image', 'memory'];

      for (const tab of tabs) {
        vm.setActiveTab(tab);
        expect(vm.activeTab).toBe(tab);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-2: Config bridging & save lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-2: Config bridging', () => {
    test('config getter should proxy ConfigService state', async () => {
      const vm = await getViewModel();

      expect(vm.config.preferredModel).toBe('');
      expect(vm.config.image.checkpoint).toBe('sd_xl_base_1.0');
    });

    test('isLoaded should proxy ConfigService isLoaded', async () => {
      const vm = await getViewModel();
      expect(vm.isLoaded).toBe(false);

      mockIsLoaded = true;
      // The getter reads the live value
    });

    test('initialize should call configService.load', async () => {
      const vm = await getViewModel();
      await vm.initialize();

      expect(loadCalls).toBe(1);
    });

    test('save should call configService.save', async () => {
      const vm = await getViewModel();
      vm.save();
      // Wait for async
      await new Promise((r) => setTimeout(r, 10));

      expect(saveCalls).toBe(1);
    });

    test('save should set lastSaved timestamp', async () => {
      const vm = await getViewModel();
      await vm.save();

      expect(vm.lastSaved).toBeTruthy();
      expect(vm.lastSaved).toInclude('T'); // ISO format
    });

    test('save should set isSaving during operation', async () => {
      const vm = await getViewModel();

      expect(vm.isSaving).toBe(false);
      const savePromise = vm.save();
      expect(vm.isSaving).toBe(true);
      await savePromise;
      expect(vm.isSaving).toBe(false);
    });

    test('revert should call configService.load', async () => {
      const vm = await getViewModel();
      await vm.revert();

      expect(loadCalls).toBe(1);
    });

    test('revert should clear lastSaved', async () => {
      const vm = await getViewModel();
      await vm.save();
      expect(vm.lastSaved).toBeTruthy();

      await vm.revert();
      expect(vm.lastSaved).toBe('');
    });

    test('reset should call configService.reset', async () => {
      const vm = await getViewModel();
      await vm.reset();

      expect(resetCalls).toBe(1);
    });

    test('reset should clear lastSaved', async () => {
      const vm = await getViewModel();
      await vm.save();
      await vm.reset();

      expect(vm.lastSaved).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-3: Service detection bridging
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-3: Service detection', () => {
    test('serviceStatus should proxy detector status', async () => {
      const vm = await getViewModel();

      expect(vm.serviceStatus.comfyUi).toBe('disconnected');
      expect(vm.serviceStatus.voice).toBe('disconnected');
      expect(vm.serviceStatus.text).toBe('disconnected');
    });

    test('detectServices should call detector.detectAll', async () => {
      const vm = await getViewModel();
      await vm.detectServices();

      expect(detectAllCalls).toBe(1);
    });

    test('detectServices should set isDetecting to true during scan', async () => {
      const vm = await getViewModel();

      expect(vm.isDetecting).toBe(false);
      const detectPromise = vm.detectServices();
      expect(vm.isDetecting).toBe(true);
      await detectPromise;
      expect(vm.isDetecting).toBe(false);
    });

    test('detectService should call detector.detectService', async () => {
      const vm = await getViewModel();
      await vm.detectService('voice');

      expect(detectServiceCalls).toContain('voice');
    });

    test('detectService should update status from detector', async () => {
      mockServiceStatus.comfyUi = 'connected';

      const vm = await getViewModel();
      expect(vm.serviceStatus.comfyUi).toBe('connected');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: Domain settings — ConfigState mutations
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-4: Domain settings', () => {
    test('should expose memory config with defaults', async () => {
      const vm = await getViewModel();

      expect(vm.config.memory.contextWindow).toBe(8192);
      expect(vm.config.memory.longTermMemory).toBe(false);
      expect(vm.config.memory.maxTurns).toBe(50);
    });

    test('should expose voice config with defaults', async () => {
      const vm = await getViewModel();

      expect(vm.config.voice.engine).toBe('kokoro');
      expect(vm.config.voice.speed).toBe(1.0);
    });

    test('should expose image config with defaults', async () => {
      const vm = await getViewModel();

      expect(vm.config.image.checkpoint).toBe('sd_xl_base_1.0');
      expect(vm.config.image.width).toBe(1024);
      expect(vm.config.image.height).toBe(1024);
    });

    test('should expose apiKeys as empty by default', async () => {
      const vm = await getViewModel();

      expect(vm.config.apiKeys).toEqual({});
    });

    test('should expose models as empty array by default', async () => {
      const vm = await getViewModel();

      expect(vm.config.models).toEqual([]);
    });
  });
});
