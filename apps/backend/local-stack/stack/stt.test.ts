/**
 * apps/backend/local-stack/stack/stt.test.ts
 *
 * C-393 STT model tier tests:
 *   - the manifest carries every STT tier entry with a pinned digest
 *     (AC-11);
 *   - the fetcher's STT selection downloads exactly the chosen tier + the
 *     Silero VAD model — never every tier (Watch Point);
 *   - an explicit entry request bypasses the tier filter.
 *
 * Downloads run against a local HTTP server with known content so no
 * external network is needed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import {
  DEFAULT_STT_BATCH_MODEL,
  DEFAULT_STT_STREAM_MODEL,
  loadManifest,
  type ManifestEntry,
  run,
  STT_VAD_ENTRY_ID,
  selectSttEntries,
} from './fetch_models.ts';

const CONTENT = Buffer.from('stt tier test model bytes 0123456789');
const contentSha = await (async () => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(CONTENT).digest('hex');
})();

let server: Server<undefined>;
let baseUrl = '';

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (url.pathname === '/model.bin') {
    return new Response(CONTENT, { headers: { 'Content-Length': String(CONTENT.length) } });
  }
  return new Response('not found', { status: 404 });
};

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: handler });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const makeSttEntry = (overrides: Partial<ManifestEntry> = {}): ManifestEntry => ({
  id: 'stt-moonshine-tiny-en-int8',
  modality: 'stt',
  tier: 'any',
  license: 'MIT',
  requiresAcknowledgement: false,
  kind: 'file',
  url: `${baseUrl}/model.bin`,
  targetPath: DEFAULT_STT_STREAM_MODEL,
  bytes: CONTENT.length,
  sha256: contentSha,
  ...overrides,
});

const makeTmpDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'aikami-stt-'));

const MANIFEST_PATH = join(import.meta.dir, 'models.manifest.json');

describe('AC-11 — STT manifest entries', () => {
  it('carries every tier entry with a pinned sha256', async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    const stt = manifest.entries.filter((entry) => entry.modality === 'stt');
    const ids = stt.map((entry) => entry.id);
    expect(ids).toContain('stt-moonshine-tiny-en-int8');
    expect(ids).toContain('stt-moonshine-base-en-int8');
    expect(ids).toContain('stt-whisper-tiny');
    expect(ids).toContain('stt-whisper-base');
    expect(ids).toContain('stt-whisper-small');
    expect(ids).toContain(STT_VAD_ENTRY_ID);
    for (const entry of stt) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
    }
  });

  it('ships the minimal tier as the default (matches the shipped stack)', async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    const byPath = new Map(manifest.entries.map((entry) => [entry.targetPath, entry]));
    // The shipped default references (compose/.env/entrypoint) must resolve
    // to real manifest entries — Watch Point: reconcile default-tier model
    // with the shipped stack.
    expect(byPath.has(DEFAULT_STT_STREAM_MODEL)).toBe(true);
    expect(byPath.has(DEFAULT_STT_BATCH_MODEL)).toBe(true);
    expect(byPath.has('stt/silero_vad.onnx')).toBe(true);
  });

  it('whisper models are pinned to a repository revision', async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    const whispers = manifest.entries.filter((entry) => entry.id.startsWith('stt-whisper-'));
    for (const entry of whispers) {
      expect(entry.kind).toBe('file');
      expect(entry.repo).toBe('ggerganov/whisper.cpp');
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe('C-393 — STT tier selection (selectSttEntries)', () => {
  const entries = [
    makeSttEntry({
      id: 'stt-moonshine-tiny-en-int8',
      targetPath: 'stt/sherpa-onnx-moonshine-tiny-en-int8',
    }),
    makeSttEntry({
      id: 'stt-moonshine-base-en-int8',
      targetPath: 'stt/sherpa-onnx-moonshine-base-en-int8',
    }),
    makeSttEntry({ id: 'stt-whisper-tiny', targetPath: 'stt/whisper-tiny/ggml-tiny.bin' }),
    makeSttEntry({ id: 'stt-whisper-base', targetPath: 'stt/whisper-base/ggml-base.bin' }),
    makeSttEntry({ id: 'stt-whisper-small', targetPath: 'stt/whisper-small/ggml-small.bin' }),
    makeSttEntry({ id: STT_VAD_ENTRY_ID, targetPath: 'stt/silero_vad.onnx' }),
  ];

  it('defaults to the minimal tier + VAD', () => {
    const selected = selectSttEntries({ entries });
    const ids = selected.map((entry) => entry.id).sort();
    expect(ids).toEqual(
      ['stt-moonshine-tiny-en-int8', 'stt-silero-vad', 'stt-whisper-tiny'].sort(),
    );
  });

  it('selects an accuracy-tier stream model + whisper-small', () => {
    const selected = selectSttEntries({
      entries,
      streamModel: 'stt/sherpa-onnx-moonshine-base-en-int8',
      batchModel: 'stt/whisper-small/ggml-small.bin',
    });
    const ids = selected.map((entry) => entry.id).sort();
    expect(ids).toEqual(
      ['stt-moonshine-base-en-int8', 'stt-silero-vad', 'stt-whisper-small'].sort(),
    );
  });

  it('treats an empty-string model selection as the shipped default', () => {
    // Compose interpolates an unset env var to an empty string; that must
    // select the minimal tier, not fetch nothing.
    const selected = selectSttEntries({ entries, streamModel: '', batchModel: '' });
    const ids = selected.map((entry) => entry.id).sort();
    expect(ids).toEqual(
      ['stt-moonshine-tiny-en-int8', 'stt-silero-vad', 'stt-whisper-tiny'].sort(),
    );
  });

  it('always includes the VAD model', () => {
    const selected = selectSttEntries({
      entries,
      streamModel: 'stt/sherpa-onnx-moonshine-base-en-int8',
    });
    expect(selected.map((entry) => entry.id)).toContain(STT_VAD_ENTRY_ID);
  });
});

describe('C-393 — fetcher STT tier scoping (run)', () => {
  it('fetches only the selected tier when the stt profile is enabled', async () => {
    const dir = await makeTmpDir();
    const manifestPath = join(dir, 'models.manifest.json');
    const entries = [
      makeSttEntry({
        id: 'stt-moonshine-tiny-en-int8',
        targetPath: 'stt/sherpa-onnx-moonshine-tiny-en-int8',
      }),
      makeSttEntry({
        id: 'stt-moonshine-base-en-int8',
        targetPath: 'stt/sherpa-onnx-moonshine-base-en-int8',
      }),
      makeSttEntry({ id: 'stt-whisper-tiny', targetPath: 'stt/whisper-tiny/ggml-tiny.bin' }),
      makeSttEntry({ id: 'stt-whisper-base', targetPath: 'stt/whisper-base/ggml-base.bin' }),
      makeSttEntry({ id: STT_VAD_ENTRY_ID, targetPath: 'stt/silero_vad.onnx' }),
    ];
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, entries }));
    const code = await run({
      manifestPath,
      modelsDir: dir,
      profiles: 'stt',
      sttStreamModel: 'stt/sherpa-onnx-moonshine-tiny-en-int8',
      sttBatchModel: 'stt/whisper-tiny/ggml-tiny.bin',
    });
    expect(code).toBe(0);
    expect(Bun.file(join(dir, 'stt/sherpa-onnx-moonshine-tiny-en-int8')).exists()).resolves.toBe(
      true,
    );
    expect(Bun.file(join(dir, 'stt/silero_vad.onnx')).exists()).resolves.toBe(true);
    expect(Bun.file(join(dir, 'stt/whisper-tiny/ggml-tiny.bin')).exists()).resolves.toBe(true);
    // Other tiers must NOT be fetched.
    expect(Bun.file(join(dir, 'stt/sherpa-onnx-moonshine-base-en-int8')).exists()).resolves.toBe(
      false,
    );
    expect(Bun.file(join(dir, 'stt/whisper-base/ggml-base.bin')).exists()).resolves.toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('an explicit entry request bypasses the tier filter', async () => {
    const dir = await makeTmpDir();
    const manifestPath = join(dir, 'models.manifest.json');
    const entries = [
      makeSttEntry({ id: 'stt-whisper-base', targetPath: 'stt/whisper-base/ggml-base.bin' }),
      makeSttEntry({ id: STT_VAD_ENTRY_ID, targetPath: 'stt/silero_vad.onnx' }),
    ];
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, entries }));
    const code = await run({
      manifestPath,
      modelsDir: dir,
      profiles: 'stt',
      entryIds: ['stt-whisper-base'],
    });
    expect(code).toBe(0);
    expect(Bun.file(join(dir, 'stt/whisper-base/ggml-base.bin')).exists()).resolves.toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
