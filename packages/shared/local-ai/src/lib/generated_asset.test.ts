// packages/shared/local-ai/src/lib/generated_asset.test.ts
//
// C-510: the single `GeneratedAsset` derivation — slug rules, tag templating,
// content hashing and `generated:<engine>` provenance. Both sinks (catalog
// staging and the client registry) call this, so the rules are asserted once.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { describe, expect, test } from 'bun:test';
import type { AssetRecipe, GenerationResult } from '@aikami/types';
import {
  deriveTag,
  expandTagTemplate,
  mimeTypeForExt,
  sha256Hex,
  slugifyPrompt,
  toGeneratedAsset,
} from './generated_asset.ts';
import { requireRecipe } from './recipes/recipe_registry.ts';

/** A stable, independently-checked digest shape assertion helper. */
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const resultFor = (bytes: Uint8Array, prompt: string): GenerationResult => ({
  bytes,
  mimeType: 'image/png',
  width: 512,
  height: 512,
  engine: 'sdcpp',
  seed: 42,
  metadata: { bytes: bytes.length, prompt },
});

const propRecipe = (): AssetRecipe => requireRecipe('prop');

describe('slugifyPrompt', () => {
  test('lowercases and collapses every run of non-alphanumerics', () => {
    expect(slugifyPrompt('Rusty iron gate!')).toBe('rusty-iron-gate');
    expect(slugifyPrompt('  a   B  -- c  ')).toBe('a-b-c');
    expect(slugifyPrompt('café — déjà vu')).toBe('caf-d-j-vu');
  });

  test('trims leading and trailing dashes', () => {
    expect(slugifyPrompt('---gate---')).toBe('gate');
  });

  test('an all-punctuation prompt slugifies to an empty string', () => {
    expect(slugifyPrompt('!!!')).toBe('');
  });
});

describe('expandTagTemplate / deriveTag', () => {
  test('substitutes {{slug}}', () => {
    expect(expandTagTemplate('props:{{slug}}', 'rusty-iron-gate')).toBe('props:rusty-iron-gate');
  });

  test('a template without the placeholder passes through', () => {
    expect(expandTagTemplate('props:fixed', 'x')).toBe('props:fixed');
  });

  test('derives the shipped props tag', () => {
    expect(deriveTag(propRecipe(), 'Rusty iron gate')).toBe('props:rusty-iron-gate');
  });

  test('falls back to <category>:<slug> when no template is declared', () => {
    const recipe = { ...propRecipe(), tagTemplate: undefined };
    expect(deriveTag(recipe, 'A gate')).toBe('props:a-gate');
  });

  test('an empty slug fails loudly', () => {
    expect(() => deriveTag(propRecipe(), '!!!')).toThrow(/slugifies to an empty string/);
  });

  test('a template producing an invalid tag fails loudly', () => {
    const recipe = { ...propRecipe(), tagTemplate: 'Props:{{slug}}' };
    expect(() => deriveTag(recipe, 'a gate')).toThrow(/invalid tag/);
  });
});

describe('sha256Hex', () => {
  test('produces a 64-character lowercase hex digest', async () => {
    const digest = await sha256Hex(new Uint8Array([1, 2, 3]));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test('is stable across calls and sensitive to content', async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 3]));
    const c = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('matches the known SHA-256 of the empty input', async () => {
    expect(await sha256Hex(new Uint8Array([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('mimeTypeForExt', () => {
  test('maps known extensions and falls back to octet-stream', () => {
    expect(mimeTypeForExt('.png')).toBe('image/png');
    expect(mimeTypeForExt('.webp')).toBe('image/webp');
    expect(mimeTypeForExt('.xyz')).toBe('application/octet-stream');
  });
});

describe('toGeneratedAsset', () => {
  test('derives tag, hash, size, ext and provenance from the result', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const asset = await toGeneratedAsset(
      resultFor(bytes, 'Rusty iron gate'),
      propRecipe(),
      'sdcpp',
    );

    expect(asset.recipeId).toBe('prop');
    expect(asset.category).toBe('props');
    expect(asset.tag).toBe('props:rusty-iron-gate');
    expect(asset.sha256).toBe(await sha256Hex(bytes));
    expect(asset.sizeBytes).toBe(4);
    expect(asset.ext).toBe('.png');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.engine).toBe('sdcpp');
    expect(asset.seed).toBe(42);
    expect(asset.prompt).toBe('Rusty iron gate');
    expect(asset.provenance.source).toBe('generated:sdcpp');
    // Generated work has no upstream licence and no human author to credit.
    expect(asset.provenance.license).toBeUndefined();
    expect(asset.provenance.author).toBeUndefined();
  });

  test('records the engine in the provenance provider', async () => {
    const asset = await toGeneratedAsset(
      resultFor(new Uint8Array([1]), 'x'),
      propRecipe(),
      'comfyui',
    );
    expect(asset.provenance.source).toBe('generated:comfyui');
    expect(asset.engine).toBe('comfyui');
  });

  test('an explicit prompt option wins over the result metadata', async () => {
    const asset = await toGeneratedAsset(
      resultFor(new Uint8Array([1]), 'compiled template text'),
      propRecipe(),
      'sdcpp',
      { prompt: 'a lantern' },
    );
    expect(asset.tag).toBe('props:a-lantern');
    expect(asset.prompt).toBe('a lantern');
  });

  test('falls back to the recipe template when the result carries no prompt', async () => {
    const result = { ...resultFor(new Uint8Array([1]), 'x'), metadata: { bytes: 1 } };
    const asset = await toGeneratedAsset(result, propRecipe(), 'sdcpp');
    expect(asset.prompt).toBe(propRecipe().promptTemplate);
  });

  test('the derived tag satisfies the registry tag grammar', async () => {
    const asset = await toGeneratedAsset(
      resultFor(new Uint8Array([1]), 'Rusty Iron Gate!'),
      propRecipe(),
      'sdcpp',
    );
    expect(asset.tag).toMatch(/^[a-z0-9]+(:[a-z0-9_.-]+)+$/);
  });

  test('the tileset recipe keeps the extension in its tag (tagIncludesExtension)', async () => {
    const asset = await toGeneratedAsset(
      resultFor(new Uint8Array([1]), 'grass'),
      requireRecipe('tileset'),
      'sdcpp',
    );
    expect(asset.tag).toBe('tilesets:grass.png');
    expect(asset.ext).toBe('.png');
  });

  test('rejects PNG bytes for a recipe that declares WebP output', async () => {
    await expect(
      toGeneratedAsset(
        resultFor(new Uint8Array([1]), 'portrait'),
        requireRecipe('portrait'),
        'sdcpp',
      ),
    ).rejects.toThrow(/declares \.webp.*engine returned image\/png/);
  });

  test('a digest is reproducible for identical bytes (idempotency by content)', async () => {
    const first = await toGeneratedAsset(
      resultFor(new Uint8Array([5, 5, 5]), 'gate'),
      propRecipe(),
      'sdcpp',
    );
    const second = await toGeneratedAsset(
      resultFor(new Uint8Array([5, 5, 5]), 'gate'),
      propRecipe(),
      'sdcpp',
    );
    expect(first.sha256).toBe(second.sha256);
    expect(first.tag).toBe(second.tag);
    expect(first.sha256).toMatch(SHA256_PATTERN);
  });
});
