#!/usr/bin/env bun

// scripts/src/lib/dist/upload_ort.ts
//
// Publish the onnxruntime-web runtime assets to the R2 distribution plane
// (`aikami-dist`), so the client fetches them at runtime instead of bundling
// them (see docs/architecture/object-storage-layout.md §7).
//
// Objects are stored under an immutable, version-pinned directory:
//   models/ort/<ort-version>/ort-wasm-simd-threaded.<variant>.{mjs,wasm}
// The client points wasmPaths at
//   <origin>/models/ort/<ort-version>/
// and onnxruntime resolves the exact variant pair.
//
// The version and filenames come from `@aikami/constants` (ORT_RUNTIME_VERSION /
// ORT_VARIANT_FILES) — the same source the browser runtime seam and the deploy
// asset guard read — so an ORT upgrade cannot leave the bucket and the bundle
// out of sync.
//
// Verification
// ------------
// --verify (or the automatic post-upload pass) does a public HTTP HEAD against
// every published object and asserts the response a browser actually needs:
//   - 200 OK
//   - Content-Type: application/wasm (wasm) / text/javascript (mjs)
//   - Cache-Control contains immutable
//   - Access-Control-Allow-Origin present
// The last one is the one that silently breaks the app: these objects are
// fetched CROSS-ORIGIN from the client Worker domain, so the R2 bucket must
// carry a CORS policy allowing it. A missing policy returns the bytes to curl
// but the browser refuses to expose them. Run from the client app directory
// (`cd apps/frontend/client && bun ../../../scripts/src/lib/dist/upload_ort.ts`),
// because `onnxruntime-web` resolves from there.
//
// Usage:
//   bun run scripts/src/lib/dist/upload_ort.ts [--mode production] [--verify]
//
// Env (scripts/.env.{mode}): CLOUD_FLARE_DIST_BUCKET_* + DIST_ORIGIN_URL.

import { dirname, join } from 'node:path';
import { ORT_RUNTIME_FILES, ORT_RUNTIME_VERSION, ortDistDirectory } from '@aikami/constants';
import { resolveDistConfig } from './config.ts';

/** One published object and its required response headers. */
export type PublishedObjectExpectation = {
  readonly filename: string;
  readonly url: string;
  readonly contentType: string;
};

/** The result of verifying one published object. */
export type PublishedObjectCheck = {
  readonly filename: string;
  readonly url: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly observed: {
    readonly status: number;
    readonly contentType: string | null;
    readonly cacheControl: string | null;
    readonly allowOrigin: string | null;
  };
};

/** The Content-Type a browser needs for each ORT object kind. */
export const contentTypeFor = (filename: string): string =>
  filename.endsWith('.mjs') ? 'text/javascript' : 'application/wasm';

/**
 * Build the public URLs every ORT object must be reachable at.
 *
 * Pure so tests can pin the versioned layout without network access.
 */
export const publishedObjectExpectations = (originUrl: string): PublishedObjectExpectation[] => {
  const base = `${originUrl.replace(/\/+$/, '')}/${ortDistDirectory(ORT_RUNTIME_VERSION)}`;
  return ORT_RUNTIME_FILES.map((filename) => ({
    filename,
    url: `${base}${filename}`,
    contentType: contentTypeFor(filename),
  }));
};

/**
 * Validate the response headers for one published ORT object.
 *
 * `allowOrigin` is checked for presence, not a specific value: the client is
 * served from several hostnames (staging, production, Tauri custom protocol),
 * so any permissive policy is acceptable — a missing one is not.
 */
export const checkPublishedObject = (
  expectation: PublishedObjectExpectation,
  response: {
    status: number;
    contentType: string | null;
    cacheControl: string | null;
    allowOrigin: string | null;
  },
): PublishedObjectCheck => {
  const problems: string[] = [];
  if (response.status !== 200) {
    problems.push(`expected 200, got ${response.status}`);
  }
  if (response.contentType !== expectation.contentType) {
    problems.push(
      `expected Content-Type ${expectation.contentType}, got ${response.contentType ?? '(none)'}`,
    );
  }
  if (!response.cacheControl?.includes('immutable')) {
    problems.push(
      `expected Cache-Control to include "immutable", got ${response.cacheControl ?? '(none)'}`,
    );
  }
  if (!response.allowOrigin) {
    problems.push(
      'missing Access-Control-Allow-Origin — the bucket CORS policy must allow the client origins',
    );
  }
  return {
    filename: expectation.filename,
    url: expectation.url,
    ok: problems.length === 0,
    problems,
    observed: response,
  };
};

/** HEAD every published object and return the per-object checks. */
const verifyPublishedObjects = async (
  originUrl: string,
): Promise<PublishedObjectCheck[]> => {
  const expectations = publishedObjectExpectations(originUrl);
  const checks: PublishedObjectCheck[] = [];
  for (const expectation of expectations) {
    try {
      const response = await fetch(expectation.url, {
        method: 'HEAD',
        headers: { Origin: 'https://aikami.bearlysleeping.com' },
        signal: AbortSignal.timeout(30_000),
      });
      checks.push(
        checkPublishedObject(expectation, {
          status: response.status,
          contentType: response.headers.get('content-type'),
          cacheControl: response.headers.get('cache-control'),
          allowOrigin: response.headers.get('access-control-allow-origin'),
        }),
      );
    } catch (error) {
      const failed = checkPublishedObject(expectation, {
        status: 0,
        contentType: null,
        cacheControl: null,
        allowOrigin: null,
      });
      checks.push({
        ...failed,
        problems: [...failed.problems, `request failed: ${String(error)}`],
      });
    }
  }
  return checks;
};

/**
 * CLI entry.
 *
 * Uploads any missing object (unless `--verify`), then always verifies the
 * public responses.
 *
 * @returns 0 when every object is published and browser-usable, 1 otherwise.
 */
export const runCli = async (argv: string[] = process.argv.slice(2)): Promise<number> => {
  const modeIndex = argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : 'production';
  const verifyOnly = argv.includes('--verify');

  const config = resolveDistConfig(mode);
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('🚀 ORT runtime upload → dist plane');
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`   Mode:    ${mode}`);
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`   Bucket:  ${config.bucket}`);
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`   Origin:  ${config.originUrl}`);
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`   Version: ${ORT_RUNTIME_VERSION}`);

  const prefix = ortDistDirectory(ORT_RUNTIME_VERSION);
  let uploaded = 0;
  let skipped = 0;

  if (!verifyOnly) {
    /**
     * The onnxruntime-web package dist directory. Resolved through the
     * lockfile (never a hand-written path) so the uploaded bytes always match
     * the version the app actually bundles. Pinned by root
     * `overrides.onnxruntime-web`.
     */
    const packagePath = Bun.resolveSync('onnxruntime-web/package.json', process.cwd());
    const installedVersion = (JSON.parse(await Bun.file(packagePath).text()) as { version: string })
      .version;
    if (installedVersion !== ORT_RUNTIME_VERSION) {
      // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
      console.error(
        `❌ onnxruntime-web version mismatch: installed ${installedVersion}, ` +
          `ORT_RUNTIME_VERSION ${ORT_RUNTIME_VERSION}. The publisher and the ` +
          'runtime seam must agree on one version — update the root override, ' +
          'the client dependency, and ORT_RUNTIME_VERSION together.',
      );
      return 1;
    }
    const ortDistDir = join(dirname(packagePath), 'dist');

    const s3 = new Bun.S3Client({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: 'auto',
    });

    // Idempotent: list the version prefix once, skip objects already present.
    const existing = await s3.list({ prefix });
    const existingKeys = new Set((existing.contents ?? []).map((object) => object.key));

    for (const filename of ORT_RUNTIME_FILES) {
      const key = `${prefix}${filename}`;
      const sourcePath = join(ortDistDir, filename);
      const source = Bun.file(sourcePath);

      if (existingKeys.has(key)) {
        // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
        console.log(`⏭  Already present: ${key}`);
        skipped++;
        continue;
      }

      if (!(await source.exists())) {
        // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
        console.error(`❌ onnxruntime asset not found: ${sourcePath}`);
        return 1;
      }

      // Immutable, one-year cache — the version in the key makes the URL
      // permanent, so a newer ORT release gets a new directory rather than
      // overwriting bytes. Bun's S3 client does not expose per-object
      // Cache-Control on write(), so the PUT goes through a presigned URL with
      // explicit headers (same technique as catalog/upload.ts).
      const body = await source.arrayBuffer();
      const url = s3.file(key).presign({ method: 'PUT', expiresIn: 300 });
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': contentTypeFor(filename),
        },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
        console.error(`❌ S3 PUT ${key} failed (${response.status}) ${text.slice(0, 200)}`);
        return 1;
      }
      // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
      console.log(
        `✅ Uploaded ${key} (${(body.byteLength / 1024 / 1024).toFixed(1)} MiB, ${contentTypeFor(filename)})`,
      );
      uploaded++;
    }
  }

  // Verify the public face of every object, always. Uploading bytes is only
  // half the contract; a missing CORS policy or wrong Content-Type means the
  // browser still cannot use them.
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('');
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('🔎 Verifying public responses (status, Content-Type, Cache-Control, CORS)...');
  const checks = await verifyPublishedObjects(config.originUrl);
  const failures = checks.filter((check) => !check.ok);

  for (const check of checks) {
    const label = check.ok ? '✅' : '❌';
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(`${label} ${check.filename}`);
    if (!check.ok) {
      for (const problem of check.problems) {
        // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
        console.log(`     - ${problem}`);
      }
    }
  }

  const wasmPath = `${config.originUrl}/${prefix}`;
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('');
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`📌 Runtime base URL for the client (${uploaded} uploaded, ${skipped} present):`);
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`   ${wasmPath}`);
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('');

  if (failures.length > 0) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(
      [
        `❌ ${failures.length} of ${checks.length} object(s) are not browser-usable at ${config.originUrl}.`,
        '',
        'The dist plane is fetched CROSS-ORIGIN by the client Worker. Fix the R2',
        'bucket CORS policy to allow the client origins (at minimum',
        'https://aikami.bearlysleeping.com and https://aikami.stg.bearlysleeping.com)',
        'with GET/HEAD, and ensure `.wasm` is served as application/wasm.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('✅ All ORT runtime objects are published and browser-usable.');
  return 0;
};

if (import.meta.main) {
  process.exit(await runCli());
}
