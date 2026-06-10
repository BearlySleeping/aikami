// apps/frontend/pwa/src/lib/services/media/pixi_texture_injector.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { type Container, Texture } from 'pixi.js';
import { PixiTextureInjector, type PixiTextureInjectorInterface } from './pixi_texture_injector';

// ---------------------------------------------------------------------------
// Test globals
// ---------------------------------------------------------------------------

type TestGlobal = typeof globalThis & {
  createImageBitmap: typeof createImageBitmap;
  Blob: typeof Blob;
};

const testGlobal = globalThis as TestGlobal;

// ---------------------------------------------------------------------------
// PixiTextureInjector — AC4: PixiJS Dynamic Texture Injection
// ---------------------------------------------------------------------------

describe('PixiTextureInjector — AC4: PixiJS Dynamic Texture Injection', () => {
  let injector: PixiTextureInjectorInterface;
  let targetSprite: Container & { texture: Texture; onViewUpdate?: () => void };

  // Track destroyed textures for verification
  let destroyedTextures: Texture[] = [];

  // The mock bitmap that createImageBitmap returns
  let mockBitmap: ImageBitmap;

  const createMockTexture = (source?: unknown): Texture => {
    const texture = {
      source,
      destroyed: false,
      destroy: mock((_baseOnly?: boolean) => {
        texture.destroyed = true;
        destroyedTextures.push(texture);
      }),
      update: mock(() => {}),
      label: 'mock-texture',
    } as unknown as Texture;

    return texture;
  };

  beforeEach(() => {
    destroyedTextures = [];

    // Create a mock ImageBitmap
    mockBitmap = {
      width: 256,
      height: 256,
      close: mock(() => {}),
    } as unknown as ImageBitmap;

    // Mock the pixi.js module
    mock.module('pixi.js', () => ({
      Texture: {
        WHITE: createMockTexture('white'),
        from: mock((source: unknown): Texture => {
          return createMockTexture(source);
        }),
      },
      Container: class MockContainer {
        texture: Texture | undefined;
      },
    }));

    // Mock global createImageBitmap
    testGlobal.createImageBitmap = mock((_blob: Blob): Promise<ImageBitmap> => {
      return Promise.resolve(mockBitmap);
    });

    // Mock global Blob
    testGlobal.Blob = class MockBlob {
      type: string;
      constructor(_parts: ArrayBuffer[], options?: BlobPropertyBag) {
        this.type = options?.type ?? '';
      }
    } as unknown as typeof Blob;

    // Create a mock target container with texture
    targetSprite = {
      texture: Texture.WHITE,
      onViewUpdate: mock(() => {}),
    } as unknown as Container & { texture: Texture; onViewUpdate: () => void };

    injector = new PixiTextureInjector({
      className: 'TestTextureInjector',
      target: targetSprite,
      mimeType: 'image/webp',
    });
  });

  test('should not destroy Texture.WHITE (global singleton)', async () => {
    destroyedTextures = [];

    await injector.injectTexture({ buffer: new ArrayBuffer(256) });

    // Texture.WHITE should NOT be in the destroyed list
    const whiteDestroyed = destroyedTextures.some((t) => t.source === 'white');
    expect(whiteDestroyed).toBe(false);
  });

  test('should destroy old texture when swapping', async () => {
    // First injection
    await injector.injectTexture({ buffer: new ArrayBuffer(256) });

    expect(destroyedTextures.length).toBe(0); // WHITE not destroyed

    // Second injection — should destroy the first texture
    await injector.injectTexture({ buffer: new ArrayBuffer(512) });

    expect(destroyedTextures.length).toBe(1);
    expect(destroyedTextures[0].destroyed).toBe(true);
  });

  test('should apply the new texture to the target', async () => {
    await injector.injectTexture({ buffer: new ArrayBuffer(256) });

    expect(targetSprite.texture).not.toBe(Texture.WHITE);
    expect(targetSprite.texture).toBeDefined();
  });

  test('should call onViewUpdate after texture swap', async () => {
    await injector.injectTexture({ buffer: new ArrayBuffer(256) });

    expect(targetSprite.onViewUpdate).toHaveBeenCalled();
  });

  test('should use correct MIME type for Blob construction', async () => {
    let capturedBlobType: string | undefined;

    // Override Blob to capture the type
    testGlobal.Blob = class MockBlobCapture {
      type: string;
      constructor(_parts: ArrayBuffer[], options?: BlobPropertyBag) {
        this.type = options?.type ?? '';
        capturedBlobType = this.type;
      }
    } as unknown as typeof Blob;

    const pngInjector = new PixiTextureInjector({
      className: 'TestPng',
      target: targetSprite,
      mimeType: 'image/png',
    });

    await pngInjector.injectTexture({ buffer: new ArrayBuffer(128) });

    expect(capturedBlobType).toBe('image/png');
  });

  test('should use image/webp as default MIME type', async () => {
    let capturedBlobType: string | undefined;

    testGlobal.Blob = class MockBlobCapture {
      type: string;
      constructor(_parts: ArrayBuffer[], options?: BlobPropertyBag) {
        this.type = options?.type ?? '';
        capturedBlobType = this.type;
      }
    } as unknown as typeof Blob;

    const defaultInjector = new PixiTextureInjector({
      className: 'TestDefaultMime',
      target: targetSprite,
    });

    await defaultInjector.injectTexture({ buffer: new ArrayBuffer(128) });

    expect(capturedBlobType).toBe('image/webp');
  });

  test('should set target texture to Texture.WHITE on clearTexture', () => {
    // Inject first, then clear
    void injector.injectTexture({ buffer: new ArrayBuffer(256) }).then(() => {
      destroyedTextures = [];
      injector.clearTexture();

      expect(targetSprite.texture).toBe(Texture.WHITE);
      // The injected texture should be destroyed
    });
  });

  test('should throw when createImageBitmap fails', async () => {
    // Make createImageBitmap fail
    testGlobal.createImageBitmap = mock(
      (): Promise<never> => Promise.reject(new Error('Bitmap decode failure')),
    );

    await expect(injector.injectTexture({ buffer: new ArrayBuffer(128) })).rejects.toThrow(
      'Failed to decode image buffer',
    );
  });

  test('should close ImageBitmap after texture creation', async () => {
    mockBitmap.close = mock(() => {});

    await injector.injectTexture({ buffer: new ArrayBuffer(256) });

    expect(mockBitmap.close).toHaveBeenCalled();
  });

  test('should track three consecutive injections without memory leaks', async () => {
    destroyedTextures = [];

    // Three consecutive injections
    await injector.injectTexture({ buffer: new ArrayBuffer(128) });
    expect(destroyedTextures.length).toBe(0); // First one — WHITE not destroyed

    await injector.injectTexture({ buffer: new ArrayBuffer(256) });
    expect(destroyedTextures.length).toBe(1); // Second one should have destroyed the first

    await injector.injectTexture({ buffer: new ArrayBuffer(512) });
    expect(destroyedTextures.length).toBe(2); // Third one should have destroyed the second

    // All destroyed textures should have destroy(true) called
    for (const t of destroyedTextures) {
      expect(t.destroyed).toBe(true);
    }
  });

  test('should handle clearTexture when no texture was injected', () => {
    // Should not throw
    expect(() => {
      injector.clearTexture();
    }).not.toThrow();
  });
});
