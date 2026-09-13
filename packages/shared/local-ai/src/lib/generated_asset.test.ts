// packages/shared/local-ai/src/lib/generated_asset.test.ts
//
// C-510: the single `GeneratedAsset` derivation — slug rules, tag templating,
// content hashing and `generated:<engine>` provenance. Both sinks (catalog
// staging and the client registry) call this, so the rules are asserted once.
//
// C-517 AC-2: the derivation is also the single *byte-format* authority. The
// bytes are sniffed; the sniffed container must agree with the engine's
// declared MIME and with the recipe's declared extension, and an undecodable
// payload is refused before any bytes are staged.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline
// Contract: C-517 Generation request and format correctness

import { describe, expect, test } from 'bun:test';
import type { AssetRecipe, GenerationResult } from '@aikami/types';
import {
  minimalContainers,
  pngBytes,
  undecodableBytes,
  wavBytes,
  webpBytes,
} from './__fixtures__/media_bytes.ts';
import {
  deriveTag,
  expandTagTemplate,
  extForMimeType,
  mimeTypeForExt,
  sha256Hex,
  slugifyPrompt,
  sniffMimeType,
  toGeneratedAsset,
} from './generated_asset.ts';
import { registerRecipe, requireRecipe } from './recipes/recipe_registry.ts';

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

/**
 * A test-only recipe declaring `.webp`. No SHIPPED recipe may declare WebP
 * until C-520 ships a real transformation — relabelling PNG bytes as WebP is
 * exactly what this contract forbids.
 */
let _webpProbe: AssetRecipe | undefined;
const webpProbeRecipe = (): AssetRecipe => {
  if (_webpProbe === undefined) {
    _webpProbe = registerRecipe({
      id: 'test-webp-probe',
      category: 'props',
      modality: 'image',
      engine: 'sdcpp',
      promptTemplate: '{{prompt}}, a webp probe',
      output: { ext: '.webp' },
      tagTemplate: 'props:webp-{{slug}}',
    });
  }
  return _webpProbe;
};

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

describe('extForMimeType (C-512)', () => {
  test('maps known MIME types to their canonical extension', () => {
    expect(extForMimeType('image/png')).toBe('.png');
    expect(extForMimeType('audio/wav')).toBe('.wav');
  });

  test('ignores parameters and case', () => {
    expect(extForMimeType('IMAGE/WEBP; charset=binary')).toBe('.webp');
  });

  test('an unknown MIME type has no extension', () => {
    expect(extForMimeType('application/octet-stream')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C-517 AC-2: the byte-format authority
// ---------------------------------------------------------------------------

describe('sniffMimeType (C-517 AC-2)', () => {
  test('identifies every container the MIME table declares', () => {
    const expectations: readonly [Uint8Array, string][] = [
      [pngBytes(), 'image/png'],
      [webpBytes(), 'image/webp'],
      [wavBytes({ frames: 4 }), 'audio/wav'],
      [minimalContainers.jpeg(), 'image/jpeg'],
      [minimalContainers.gif(), 'image/gif'],
      [minimalContainers.mp3(), 'audio/mpeg'],
      [minimalContainers.ogg(), 'audio/ogg'],
      [minimalContainers.flac(), 'audio/flac'],
      [minimalContainers.aac(), 'audio/aac'],
      [minimalContainers.m4a(), 'audio/mp4'],
      [minimalContainers.webm(), 'video/webm'],
      [minimalContainers.avif(), 'image/avif'],
      [minimalContainers.avifCompatible(), 'image/avif'],
      [minimalContainers.avisCompatible(), 'image/avif'],
      [minimalContainers.svg(), 'image/svg+xml'],
    ];

    for (const [bytes, expected] of expectations) {
      expect(sniffMimeType(bytes)).toBe(expected);
    }
  });

  test('every sniffed MIME type maps back to the extension it came from', () => {
    for (const bytes of [pngBytes(), webpBytes(), wavBytes({ frames: 4 })]) {
      const mime = sniffMimeType(bytes);
      expect(mime).toBeDefined();
      expect(extForMimeType(mime ?? '')).toBeDefined();
      expect(mimeTypeForExt(extForMimeType(mime ?? '') ?? '')).toBe(mime);
    }
  });

  test('returns undefined for an empty or unrecognised payload', () => {
    expect(sniffMimeType(new Uint8Array())).toBeUndefined();
    expect(sniffMimeType(undecodableBytes())).toBeUndefined();
    // A generic ISO-BMFF container is not claimed to be audio (or an image)
    // just because it is BMFF.
    expect(
      sniffMimeType(new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])),
    ).toBeUndefined();
    // A PNG signature truncated to three bytes is not a PNG.
    expect(sniffMimeType(pngBytes().slice(0, 3))).toBeUndefined();
    // RIFF alone is neither WAV nor WebP.
    expect(sniffMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeUndefined();
  });

  test('does not misread a PNG as a RIFF container or vice versa', () => {
    expect(sniffMimeType(pngBytes())).not.toBe('audio/wav');
    expect(sniffMimeType(wavBytes({ frames: 4 }))).not.toBe('image/webp');
    expect(sniffMimeType(webpBytes())).not.toBe('audio/wav');
  });

  test('requires svg as the root after optional declarations and comments', () => {
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

    expect(sniffMimeType(encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      'image/svg+xml',
    );
    expect(sniffMimeType(encode('<?xml version="1.0"?><!-- generated --><svg/>'))).toBe(
      'image/svg+xml',
    );
    expect(sniffMimeType(encode('<?xml version="1.0"?>'))).toBeUndefined();
    expect(sniffMimeType(encode('<?xml version="1.0"?><html></html>'))).toBeUndefined();
    expect(sniffMimeType(encode('<!-- generated --><html></html>'))).toBeUndefined();
  });
});

describe('toGeneratedAsset — C-517 AC-2 format agreement', () => {
  test('accepts PNG bytes under a PNG recipe with a matching declared MIME', async () => {
    const bytes = pngBytes();
    const asset = await toGeneratedAsset(
      resultFor(bytes, 'Rusty iron gate'),
      propRecipe(),
      'sdcpp',
    );

    expect(sniffMimeType(bytes)).toBe('image/png');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.ext).toBe('.png');
    expect(asset.sha256).toBe(await sha256Hex(bytes));
    expect(mimeTypeForExt(asset.ext)).toBe(asset.mimeType);
  });

  test('accepts genuine WebP bytes for a test-only WebP recipe', async () => {
    const bytes = webpBytes();
    const asset = await toGeneratedAsset(
      { ...resultFor(bytes, 'a webp probe'), mimeType: 'image/webp' },
      webpProbeRecipe(),
      'sdcpp',
    );

    expect(asset.ext).toBe('.webp');
    expect(asset.mimeType).toBe('image/webp');
    expect(asset.sha256).toBe(await sha256Hex(bytes));
  });

  test('accepts WAV bytes under a WAV recipe', async () => {
    const bytes = wavBytes({ frames: 100 });
    const asset = await toGeneratedAsset(
      {
        bytes,
        mimeType: 'audio/wav',
        engine: 'ace-step',
        seed: 7,
        metadata: { format: 'wav', prompt: 'calm forest loop' },
      },
      requireRecipe('music'),
      'ace-step',
    );

    expect(asset.ext).toBe('.wav');
    expect(asset.mimeType).toBe('audio/wav');
    expect(asset.sha256).toBe(await sha256Hex(bytes));
  });

  test('rejects a payload whose declared Content-Type disagrees with its bytes', async () => {
    // The provider claims PNG; the bytes are WebP. Trusting the header would
    // register WebP bytes under a MIME they do not have.
    const declaredPng = { ...resultFor(pngBytes(), 'a probe'), mimeType: 'image/webp' };
    await expect(toGeneratedAsset(declaredPng, propRecipe(), 'sdcpp')).rejects.toThrow(
      /declared "image\/webp".*bytes are image\/png/i,
    );

    const declaredWebp = {
      ...resultFor(webpBytes(), 'a probe'),
      mimeType: 'image/png',
    };
    await expect(toGeneratedAsset(declaredWebp, webpProbeRecipe(), 'sdcpp')).rejects.toThrow(
      /declared "image\/png".*bytes are image\/webp/i,
    );
  });

  test('rejects an undecodable payload before hashing or staging', async () => {
    await expect(
      toGeneratedAsset(resultFor(undecodableBytes(), 'a probe'), propRecipe(), 'sdcpp'),
    ).rejects.toThrow(/unrecognised (image|media) container|undecodable/i);
  });

  test('rejects a payload whose container disagrees with the recipe extension', async () => {
    // Recipe declares PNG; the engine handed back genuine WebP bytes and
    // honestly labelled them. No relabelling is permitted.
    await expect(
      toGeneratedAsset(
        { ...resultFor(webpBytes(), 'a gate'), mimeType: 'image/webp' },
        propRecipe(),
        'sdcpp',
      ),
    ).rejects.toThrow(
      /declares \.png \(image\/png\) but the (engine returned|bytes are) image\/webp/,
    );
  });
});

describe('toGeneratedAsset — C-512 tag override', () => {
  test('an explicit tag wins over the prompt-derived slug', async () => {
    const asset = await toGeneratedAsset(
      resultFor(pngBytes(), 'merchant neutral'),
      propRecipe(),
      'sdcpp',
      { tag: 'portraits:merchant-neutral' },
    );

    expect(asset.tag).toBe('portraits:merchant-neutral');
  });

  test('an invalid tag override fails loudly rather than registering an unreachable row', async () => {
    await expect(
      toGeneratedAsset(resultFor(pngBytes(), 'x'), propRecipe(), 'sdcpp', {
        tag: 'Not A Tag',
      }),
    ).rejects.toThrow(/invalid tag override/);
  });
});

describe('toGeneratedAsset', () => {
  test('derives tag, hash, size, ext and provenance from the result', async () => {
    const bytes = pngBytes();
    const asset = await toGeneratedAsset(
      resultFor(bytes, 'Rusty iron gate'),
      propRecipe(),
      'sdcpp',
    );

    expect(asset.recipeId).toBe('prop');
    expect(asset.category).toBe('props');
    expect(asset.tag).toBe('props:rusty-iron-gate');
    expect(asset.sha256).toBe(await sha256Hex(bytes));
    expect(asset.sizeBytes).toBe(bytes.length);
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
    const asset = await toGeneratedAsset(resultFor(pngBytes(), 'x'), propRecipe(), 'comfyui');
    expect(asset.provenance.source).toBe('generated:comfyui');
    expect(asset.engine).toBe('comfyui');
  });

  test('an explicit prompt option wins over the result metadata', async () => {
    const asset = await toGeneratedAsset(
      resultFor(pngBytes(), 'compiled template text'),
      propRecipe(),
      'sdcpp',
      { prompt: 'a lantern' },
    );
    expect(asset.tag).toBe('props:a-lantern');
    expect(asset.prompt).toBe('a lantern');
  });

  test('falls back to the recipe template when the result carries no prompt', async () => {
    const result = { ...resultFor(pngBytes(), 'x'), metadata: { bytes: 1 } };
    const asset = await toGeneratedAsset(result, propRecipe(), 'sdcpp');
    expect(asset.prompt).toBe(propRecipe().promptTemplate);
  });

  test('the derived tag satisfies the registry tag grammar', async () => {
    const asset = await toGeneratedAsset(
      resultFor(pngBytes(), 'Rusty Iron Gate!'),
      propRecipe(),
      'sdcpp',
    );
    expect(asset.tag).toMatch(/^[a-z0-9]+(:[a-z0-9_.-]+)+$/);
  });

  test('the tileset recipe keeps the extension in its tag (tagIncludesExtension)', async () => {
    const asset = await toGeneratedAsset(
      resultFor(pngBytes(), 'grass'),
      requireRecipe('tileset'),
      'sdcpp',
    );
    expect(asset.tag).toBe('tilesets:grass.png');
    expect(asset.ext).toBe('.png');
  });

  test('a digest is reproducible for identical bytes (idempotency by content)', async () => {
    const first = await toGeneratedAsset(resultFor(pngBytes(), 'gate'), propRecipe(), 'sdcpp');
    const second = await toGeneratedAsset(resultFor(pngBytes(), 'gate'), propRecipe(), 'sdcpp');
    expect(first.sha256).toBe(second.sha256);
    expect(first.tag).toBe(second.tag);
    expect(first.sha256).toMatch(SHA256_PATTERN);
  });
});

describe('toGeneratedAsset — C-511 audio', () => {
  const audioResult = (prompt: string): GenerationResult => ({
    bytes: wavBytes({ frames: 44_100 }),
    mimeType: 'audio/wav',
    engine: 'ace-step',
    seed: 7,
    metadata: {
      format: 'wav',
      sampleRate: 44_100,
      channels: 2,
      durationSeconds: 60,
      model: 'audio-ace-step-v1-3.5b',
      prompt,
    },
  });

  test('derives a music descriptor with the exploration tag the resolver matches', async () => {
    const asset = await toGeneratedAsset(
      audioResult('calm forest loop'),
      requireRecipe('music'),
      'ace-step',
    );
    expect(asset.category).toBe('music');
    expect(asset.tag).toBe('music:exploration:calm-forest-loop');
    expect(asset.ext).toBe('.wav');
    expect(asset.mimeType).toBe('audio/wav');
    expect(asset.provenance.source).toBe('generated:ace-step');
    expect(asset.engine).toBe('ace-step');
  });

  test('records the producing model id (C-511 AC-4)', async () => {
    const asset = await toGeneratedAsset(
      audioResult('metal gate slam'),
      requireRecipe('sfx'),
      'ace-step',
    );
    expect(asset.model).toBe('audio-ace-step-v1-3.5b');
    expect(asset.category).toBe('sfx');
    expect(asset.tag).toBe('sfx:metal-gate-slam');
  });

  test('falls back to the recipe model when the engine reports none', async () => {
    const result = audioResult('forest canopy');
    const asset = await toGeneratedAsset(
      { ...result, metadata: { ...result.metadata, model: undefined as unknown as string } },
      requireRecipe('ambient'),
      'ace-step',
    );
    expect(asset.model).toBe('audio-ace-step-v1-3.5b');
  });

  test('rejects an audio payload whose container disagrees with the recipe', async () => {
    // The engine labels MP3; the bytes are a genuine WAV container.
    await expect(
      toGeneratedAsset(
        { ...audioResult('calm forest loop'), mimeType: 'audio/mpeg' },
        requireRecipe('music'),
        'ace-step',
      ),
    ).rejects.toThrow(/declared "audio\/mpeg".*bytes are audio\/wav/i);
  });

  test('C-511 MIME table covers every offered audio container', () => {
    expect(mimeTypeForExt('.flac')).toBe('audio/flac');
    expect(mimeTypeForExt('.m4a')).toBe('audio/mp4');
    expect(mimeTypeForExt('.aac')).toBe('audio/aac');
  });
});
