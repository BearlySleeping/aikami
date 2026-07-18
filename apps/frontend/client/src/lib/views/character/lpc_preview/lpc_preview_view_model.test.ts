// apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// Unit tests for LpcPreviewViewModel — interface contract, state transitions,
// and non-rendering logic.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults
//
// Note: PixiJS rendering depends on WebGL/Canvas APIs not available in Bun.
// Visual rendering correctness is tested via the visual test suite at
// apps/e2e/src/visual/suites/onboarding_appearance.visual.ts.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/character/lpc_preview/lpc_preview_view_model.test.ts

import { beforeEach, describe, expect, it } from 'bun:test';

// ── Svelte 5 runes polyfill (matches test_preload.ts) ────────────────

(globalThis as Record<string, unknown>).$state = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.raw = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.snapshot = (value: unknown) => value;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;
const effectPolyfill = ((fn: () => void) => {
  fn();
}) as unknown as Record<string, unknown>;
effectPolyfill.root = (fn: () => void) => {
  fn();
  return () => {};
};
(globalThis as Record<string, unknown>).$effect = effectPolyfill;

// ── Mocks ─────────────────────────────────────────────────────────────

mock.module('@aikami/frontend/engine', () => ({}));

mock.module('@aikami/frontend/services', () => ({
  BaseFrontendClass: class {
    _options: { className: string };
    constructor(options: { className: string }) {
      this._options = options;
    }
    static create<O extends { className: string }>(this: new (o: O) => unknown, options: O) {
      return new this(options);
    }
    debug(..._args: unknown[]) {}
    info(..._args: unknown[]) {}
    log(..._args: unknown[]) {}
    warn(..._args: unknown[]) {}
    error(..._args: unknown[]) {}
  },
  BaseViewModel: class extends class {
    _options: { className: string };
    constructor(options: { className: string }) {
      this._options = options;
    }
    static create<O extends { className: string }>(this: new (o: O) => unknown, options: O) {
      return new this(options);
    }
    debug(..._args: unknown[]) {}
    info(..._args: unknown[]) {}
    log(..._args: unknown[]) {}
    warn(..._args: unknown[]) {}
    error(..._args: unknown[]) {}
  } {
    __mounted = false;
    errorMessage = undefined;
    get showLoadingView() {
      return false;
    }
    async initialize() {}
    async dispose() {}
    protected registerEffectRoot(fn: () => void) {
      fn();
    }
  },
  dialogService: {},
}));

mock.module('$lib/data/lpc_models', () => ({
  LpcAnimationState: {
    Spellcast: 0,
    Thrust: 4,
    Walk: 8,
    Slash: 12,
    Shoot: 16,
    Die: 20,
  },
  LpcDirection: {
    Up: 0,
    Left: 1,
    Down: 2,
    Right: 3,
  },
}));

// PixiJS facade mock — all classes are empty shells
let mockPixiInitCalled = false;
let mockPixiDestroyCalled = false;

mock.module('./lpc_preview_pixi_facade', () => {
  class MockContainer {
    children: unknown[] = [];
    x = 0;
    y = 0;
    zIndex = 0;
    alpha = 1;
    scale = { set: () => {} };
    eventMode = 'none';
    sortableChildren = false;
    parent: unknown = null;
    addChild(_c: unknown) {}
    removeChild(_c: unknown) {}
    destroy(_o?: unknown) {}
  }

  class MockSprite extends MockContainer {
    width = 0;
    height = 0;
    tint = 0xffffff;
  }

  return {
    Application: class {
      ticker = { add: () => {}, deltaMS: 16 };
      stage = { addChild: () => {} };
      renderer = { canvas: { addEventListener: () => {} } };
      init = async () => {
        mockPixiInitCalled = true;
      };
      destroy = () => {
        mockPixiDestroyCalled = true;
      };
    },
    Assets: { load: async () => ({ source: { scaleMode: 'nearest' } }) },
    Container: MockContainer,
    Graphics: class extends MockContainer {
      rect() {
        return this;
      }
      fill() {
        return this;
      }
      stroke() {
        return this;
      }
    },
    Rectangle: class {
      constructor(
        public x: number,
        public y: number,
        public width: number,
        public height: number,
      ) {}
    },
    Sprite: MockSprite,
    Texture: {
      EMPTY: { width: 1, height: 1, source: {}, uid: 'empty' },
    },
  };
});

// ── Import the VM ──────────────────────────────────────────────────────

type GetLpcPreviewViewModel = Awaited<
  ReturnType<typeof import('./lpc_preview_view_model.svelte')>
>['getLpcPreviewViewModel'];

let getVM: GetLpcPreviewViewModel;

beforeEach(async () => {
  const mod = await import('./lpc_preview_view_model.svelte');
  getVM = mod.getLpcPreviewViewModel;
});

// ── Helpers ────────────────────────────────────────────────────────────

/** Builds a minimal LpcLayerRecipe for testing. */
const makeRecipe = (
  slot: string,
  assetId: string,
  hexColor?: string,
): { slot: string; assetId: string; hexPalette: Uint8Array } => {
  const palette = new Uint8Array(1024);
  if (hexColor) {
    const r = Number.parseInt(hexColor.slice(0, 2), 16);
    const g = Number.parseInt(hexColor.slice(2, 4), 16);
    const b = Number.parseInt(hexColor.slice(4, 6), 16);
    for (let i = 0; i < 256; i++) {
      const off = i * 4;
      palette[off] = r;
      palette[off + 1] = g;
      palette[off + 2] = b;
      palette[off + 3] = 255;
    }
  }
  return { slot, assetId, hexPalette: palette };
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('LpcPreviewViewModel — initial state', () => {
  it('starts with isPlaying = false', () => {
    const vm = getVM({ className: 'TestPreview' });
    expect(vm.isPlaying).toBe(false);
  });

  it('starts with animationFrame = 0', () => {
    const vm = getVM({ className: 'TestPreview' });
    expect(vm.animationFrame).toBe(0);
  });

  it('starts with zoom = 1.0', () => {
    const vm = getVM({ className: 'TestPreview' });
    expect(vm.zoom).toBe(1.0);
  });

  it('starts with compositionFailed = false', () => {
    const vm = getVM({ className: 'TestPreview' });
    expect(vm.compositionFailed).toBe(false);
  });

  it('canvasElement starts undefined', () => {
    const vm = getVM({ className: 'TestPreview' });
    expect(vm.canvasElement).toBeUndefined();
  });
});

describe('LpcPreviewViewModel — togglePlayback', () => {
  it('toggles isPlaying from false to true', () => {
    const vm = getVM({ className: 'TestPreview' });
    vm.togglePlayback();
    expect(vm.isPlaying).toBe(true);
  });

  it('toggles isPlaying from true to false', () => {
    const vm = getVM({ className: 'TestPreview' });
    vm.togglePlayback();
    vm.togglePlayback();
    expect(vm.isPlaying).toBe(false);
  });
});

describe('LpcPreviewViewModel — setZoom', () => {
  it('updates the zoom state', () => {
    const vm = getVM({ className: 'TestPreview' });
    vm.setZoom(2.0);
    expect(vm.zoom).toBe(2.0);
  });

  it('accepts fractional zoom values', () => {
    const vm = getVM({ className: 'TestPreview' });
    vm.setZoom(1.5);
    expect(vm.zoom).toBe(1.5);
  });
});

describe('LpcPreviewViewModel — setRecipes', () => {
  it('accepts recipes without crashing (no PixiJS canvas)', () => {
    const vm = getVM({ className: 'TestPreview' });
    vm.setRecipes([makeRecipe('body', 'body/bodies_male')]);
    // Should not throw — renderCharacter returns early when no pixiApp
    // We just verify the public API works
  });

  it('accepts empty recipe array', () => {
    const vm = getVM({ className: 'TestPreview' });
    vm.setRecipes([]);
  });
});

describe('LpcPreviewViewModel — setAnimationState', () => {
  it('accepts Walk animation state', () => {
    const vm = getVM({ className: 'TestPreview' });
    // LpcAnimationState.Walk = 8
    vm.setAnimationState(8);
    // Should not throw
  });
});

describe('LpcPreviewViewModel — setCanvasElement', () => {
  it('stores the canvas reference', () => {
    const vm = getVM({ className: 'TestPreview' });
    const canvas = { width: 256, height: 256 } as HTMLCanvasElement;
    vm.setCanvasElement(canvas);
    expect(vm.canvasElement).toBe(canvas);
  });
});

describe('LpcPreviewViewModel — lifecycle', () => {
  it('initialize completes without errors', async () => {
    const vm = getVM({ className: 'TestPreview' });
    await vm.initialize();
    // Should complete without throwing
  });

  it('dispose completes without errors', async () => {
    const vm = getVM({ className: 'TestPreview' });
    await vm.initialize();
    await vm.dispose();
    // Should complete without throwing
  });

  it('initialize + dispose is idempotent', async () => {
    const vm = getVM({ className: 'TestPreview' });
    await vm.initialize();
    await vm.dispose();
    await vm.dispose();
    // Should not throw
  });

  it('initializes PixiJS when canvas element is set', async () => {
    mockPixiInitCalled = false;
    const vm = getVM({ className: 'TestPreview' });
    const canvas = { width: 256, height: 256 } as HTMLCanvasElement;
    await vm.initialize();
    vm.setCanvasElement(canvas);
    // Allow effect to run
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockPixiInitCalled).toBe(true);
  });

  it('calls Pixi destroy on dispose', async () => {
    mockPixiInitCalled = false;
    mockPixiDestroyCalled = false;
    const vm = getVM({ className: 'TestPreview' });
    const canvas = { width: 256, height: 256 } as HTMLCanvasElement;
    await vm.initialize();
    vm.setCanvasElement(canvas);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await vm.dispose();
    expect(mockPixiDestroyCalled).toBe(true);
  });
});

describe('LpcPreviewViewModel — options', () => {
  it('accepts custom width/height', () => {
    const vm = getVM({ className: 'TestPreview', width: 512, height: 384 });
    expect(vm.canvasElement).toBeUndefined();
  });

  it('accepts custom background color', () => {
    const vm = getVM({ className: 'TestPreview', backgroundColor: 0xffffff });
    expect(vm.canvasElement).toBeUndefined();
  });
});
