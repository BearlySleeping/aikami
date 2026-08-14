/**
 * apps/backend/local-stack/stack/fetch_models.test.ts
 *
 * Unit tests for the model fetcher — C-390 AC-6 (idempotent, resumable,
 * profile-scoped, checksum-verified, non-fatal) and AC-7 (use-restricted
 * models require acknowledgement).
 *
 * All downloads run against a local HTTP server with known content so no
 * external network is needed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import {
  COMPLETE_MARKER,
  downloadResumable,
  ensureEntry,
  extractTarBz2,
  loadManifest,
  type ManifestEntry,
  PART_SUFFIX,
  resolveEntryUrl,
  run,
  sha256File,
} from './fetch_models.ts';

const CONTENT = Buffer.from('hello local stack model bytes 0123456789');
let contentSha = '';

let server: Server<undefined>;
let baseUrl = '';

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (url.pathname === '/file.bin') {
    const range = req.headers.get('range');
    if (range) {
      const match = /bytes=(\d+)-/.exec(range);
      if (match) {
        const start = Number(match[1]);
        if (start >= CONTENT.length) {
          return new Response(null, { status: 416 });
        }
        const slice = CONTENT.subarray(start);
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${CONTENT.length - 1}/${CONTENT.length}`,
            'Content-Length': String(slice.length),
          },
        });
      }
    }
    return new Response(CONTENT, {
      headers: { 'Content-Length': String(CONTENT.length) },
    });
  }
  if (url.pathname === '/corrupt.bin') {
    return new Response(Buffer.from('this is not the expected content at all'), {
      headers: { 'Content-Length': '37' },
    });
  }
  return new Response('not found', { status: 404 });
};

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: handler });
  baseUrl = `http://127.0.0.1:${server.port}`;
  contentSha = await sha256FileFromBuffer(CONTENT);
});

afterAll(() => {
  server.stop(true);
});

const sha256FileFromBuffer = async (buffer: Buffer): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buffer).digest('hex');
};

const makeEntry = (overrides: Partial<ManifestEntry> = {}): ManifestEntry => ({
  id: 'test-entry',
  modality: 'text',
  tier: 'cpu',
  license: 'Apache-2.0',
  requiresAcknowledgement: false,
  kind: 'file',
  url: `${baseUrl}/file.bin`,
  targetPath: 'text/test-model.bin',
  bytes: CONTENT.length,
  sha256: contentSha,
  ...overrides,
});

const makeTmpDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'aikami-fetch-'));

describe('loadManifest', () => {
  it('parses a valid manifest', async () => {
    const dir = await makeTmpDir();
    const manifestPath = join(dir, 'models.manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            id: 'text-x',
            modality: 'text',
            tier: 'cpu',
            license: 'Apache-2.0',
            requiresAcknowledgement: false,
            kind: 'file',
            repo: 'org/repo',
            revision: 'abc',
            file: 'model.gguf',
            targetPath: 'text/model.gguf',
            bytes: 1,
            sha256: '0'.repeat(64),
          },
        ],
      }),
    );
    const manifest = await loadManifest(manifestPath);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects an invalid manifest', async () => {
    const dir = await makeTmpDir();
    const manifestPath = join(dir, 'models.manifest.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 2, entries: [] }));
    await expect(loadManifest(manifestPath)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('resolveEntryUrl', () => {
  it('uses the direct url when present', () => {
    const entry = makeEntry({ url: 'https://example.com/direct.bin' });
    expect(resolveEntryUrl(entry)).toBe('https://example.com/direct.bin');
  });

  it('builds a HuggingFace resolve URL from repo/revision/file', () => {
    const entry = makeEntry({
      url: undefined,
      repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
      revision: '9eadc661',
      file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    });
    expect(resolveEntryUrl(entry)).toBe(
      'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/9eadc661/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    );
  });
});

describe('AC-6 — downloadResumable', () => {
  it('downloads and verifies a file', async () => {
    const dir = await makeTmpDir();
    const target = join(dir, 'model.bin');
    await downloadResumable({ url: `${baseUrl}/file.bin`, target, expectedSha256: contentSha });
    expect(await readFile(target)).toEqual(CONTENT);
    await rm(dir, { recursive: true, force: true });
  });

  it('resumes from a partial .part file with a Range request', async () => {
    const dir = await makeTmpDir();
    const target = join(dir, 'model.bin');
    // Simulate an interrupted download: write the first half as .part.
    const half = CONTENT.subarray(0, Math.floor(CONTENT.length / 2));
    await mkdir(dirnameOf(target), { recursive: true });
    await writeFile(`${target}${PART_SUFFIX}`, half);

    await downloadResumable({ url: `${baseUrl}/file.bin`, target, expectedSha256: contentSha });
    expect(await readFile(target)).toEqual(CONTENT);
    await rm(dir, { recursive: true, force: true });
  });

  it('detects a corrupt download and re-fetches', async () => {
    const dir = await makeTmpDir();
    const target = join(dir, 'model.bin');
    await expect(
      downloadResumable({
        url: `${baseUrl}/corrupt.bin`,
        target,
        expectedSha256: contentSha,
      }),
    ).rejects.toThrow('checksum mismatch');
    // The part file is cleaned up after a failed verification.
    expect(Bun.file(`${target}${PART_SUFFIX}`).exists()).resolves.toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('AC-6 — ensureEntry idempotency', () => {
  it('downloads once, then reports already-present on re-run', async () => {
    const dir = await makeTmpDir();
    const entry = makeEntry();
    const first = await ensureEntry({
      entry,
      modelsDir: dir,
      acceptLicenses: new Set(),
    });
    expect(first).toBe('fetched');
    expect(await readFile(join(dir, entry.targetPath))).toEqual(CONTENT);

    const second = await ensureEntry({
      entry,
      modelsDir: dir,
      acceptLicenses: new Set(),
    });
    expect(second).toBe('already-present');
    await rm(dir, { recursive: true, force: true });
  });

  it('re-fetches a corrupted file that lacks a valid completion marker', async () => {
    const dir = await makeTmpDir();
    const entry = makeEntry();
    await ensureEntry({ entry, modelsDir: dir, acceptLicenses: new Set() });
    // Simulate a partial/unverified download: corrupt the target AND remove
    // the completion marker so the digest check runs (a marker present is the
    // trusted fast path — re-hashing multi-GB models on every start would
    // blow the warm-start budget).
    await writeFile(join(dir, entry.targetPath), 'garbage');
    await rm(`${join(dir, entry.targetPath)}${COMPLETE_MARKER}`, { force: true });
    const state = await ensureEntry({ entry, modelsDir: dir, acceptLicenses: new Set() });
    expect(state).toBe('fetched');
    expect(await readFile(join(dir, entry.targetPath))).toEqual(CONTENT);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('AC-6 — profile scoping', () => {
  it('fetches only enabled modalities', async () => {
    const dir = await makeTmpDir();
    const manifestPath = join(dir, 'models.manifest.json');
    const textEntry = makeEntry({ id: 'text-only', targetPath: 'text/a.bin' });
    const imageEntry = makeEntry({
      id: 'image-only',
      modality: 'image',
      targetPath: 'image/b.bin',
    });
    await writeFile(
      manifestPath,
      JSON.stringify({ schemaVersion: 1, entries: [textEntry, imageEntry] }),
    );
    // Only the text profile is enabled — image must not be downloaded.
    const code = await run({ manifestPath, modelsDir: dir, profiles: 'text' });
    expect(code).toBe(0);
    expect(Bun.file(join(dir, 'text/a.bin')).exists()).resolves.toBe(true);
    expect(Bun.file(join(dir, 'image/b.bin')).exists()).resolves.toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('a failed download for one modality is non-fatal', async () => {
    const dir = await makeTmpDir();
    const manifestPath = join(dir, 'models.manifest.json');
    const good = makeEntry({ id: 'good', targetPath: 'text/good.bin' });
    const bad = makeEntry({
      id: 'bad',
      modality: 'image',
      url: `${baseUrl}/does-not-exist.bin`,
      targetPath: 'image/bad.bin',
      sha256: 'f'.repeat(64),
    });
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, entries: [good, bad] }));
    const code = await run({ manifestPath, modelsDir: dir, profiles: 'text,image' });
    expect(code).toBe(0);
    expect(Bun.file(join(dir, 'text/good.bin')).exists()).resolves.toBe(true);
    expect(Bun.file(join(dir, 'image/bad.bin')).exists()).resolves.toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('AC-7 — use-restricted models require acknowledgement', () => {
  const ackEntry = (): ManifestEntry =>
    makeEntry({
      id: 'sd15',
      license: 'CreativeML OpenRAIL-M',
      requiresAcknowledgement: true,
      targetPath: 'image/sd15.bin',
    });

  it('skips the download and prints the licence without the ack flag', async () => {
    const dir = await makeTmpDir();
    const entry = ackEntry();
    const status = await ensureEntry({ entry, modelsDir: dir, acceptLicenses: new Set() });
    expect(status).toBe('skipped-ack');
    expect(Bun.file(join(dir, entry.targetPath)).exists()).resolves.toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('downloads once the licence is accepted', async () => {
    const dir = await makeTmpDir();
    const entry = ackEntry();
    const status = await ensureEntry({
      entry,
      modelsDir: dir,
      acceptLicenses: new Set(['CreativeML OpenRAIL-M']),
    });
    expect(status).toBe('fetched');
    expect(await readFile(join(dir, entry.targetPath))).toEqual(CONTENT);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('archive extraction', () => {
  it('extracts a tar.bz2 archive and marks completion', async () => {
    const { spawnSync } = await import('node:child_process');
    const dir = await makeTmpDir();
    // Build a tiny tar.bz2 archive on the fly.
    const payloadDir = join(dir, 'payload');
    await mkdir(join(payloadDir, 'model-dir'), { recursive: true });
    await writeFile(join(payloadDir, 'model-dir', 'model.onnx'), 'onnx-bytes');
    const tarball = join(dir, 'model.tar.bz2');
    const tarResult = spawnSync('tar', ['-cjf', tarball, '-C', payloadDir, 'model-dir']);
    expect(tarResult.status).toBe(0);

    const entry = makeEntry({
      id: 'archive-entry',
      modality: 'tts',
      kind: 'archive',
      url: 'https://unused.invalid/x.tar.bz2',
      targetPath: 'tts/model-dir',
      sha256: await sha256File(tarball),
      bytes: (await (await import('node:fs/promises')).stat(tarball)).size,
    });

    await extractTarBz2({ tarball, targetDir: join(dir, entry.targetPath) });
    expect(await readFile(join(dir, 'tts/model-dir/model.onnx'), 'utf8')).toBe('onnx-bytes');

    await rm(dir, { recursive: true, force: true });
  });
});

const dirnameOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
