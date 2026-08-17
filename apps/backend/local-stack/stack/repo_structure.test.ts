/**
 * apps/backend/local-stack/stack/repo_structure.test.ts
 *
 * C-390 AC-10: the removed artifacts are gone and nothing references them.
 * Also guards the manifest and compose topology invariants so a bad merge
 * cannot silently reintroduce the pre-contract state.
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/** True when a path is tracked by git (untracked local weights are a migration concern, not a repo invariant). */
const isTracked = (path: string): boolean => {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

describe('AC-10 — removed artifacts are absent', () => {
  const forbidden = [
    'Dockerfile.ultimate',
    'docker-compose.lite.yml',
    'docker/scripts/entrypoint-ultimate.sh',
    'docker/client-server/client_server.ts',
    'docker/client-server/package.json',
  ];

  for (const rel of forbidden) {
    it(`is absent: ${rel}`, () => {
      expect(existsSync(join(ROOT, rel))).toBe(false);
    });
  }

  it('no moon.yml or package.json task references the removed artifacts', async () => {
    const moon = await readFile(join(ROOT, 'moon.yml'), 'utf8');
    const pkg = await readFile(join(ROOT, 'package.json'), 'utf8');
    for (const needle of ['ultimate', 'lite', 'client-server', 'client_server']) {
      expect(moon.toLowerCase()).not.toContain(needle);
      expect(pkg.toLowerCase()).not.toContain(needle);
    }
  });
});

describe('compose topology invariants', () => {
  it('compose.yaml exists and carries no `version:` legacy key', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    expect(compose).toContain('services:');
    expect(compose).not.toMatch(/^version:\s*["']?3\./m);
  });

  it('every backend override file exists', () => {
    for (const name of ['cpu', 'cuda', 'rocm', 'vulkan', 'intel', 'musa']) {
      expect(existsSync(join(ROOT, `compose.${name}.yaml`))).toBe(true);
    }
  });

  it('every upstream image reference in the base file is digest-pinned', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    // Owned images use an env-prefixed name (no digest yet — built/published
    // by CI); every other image: reference must carry @sha256:. The match is
    // deliberately broad (any image line that is not env-prefixed) so an
    // unpinned upstream reference — e.g. a bare `oven/bun:1.3` fetcher image —
    // fails CI instead of silently passing.
    const imageLines = compose.split('\n').filter((line) => /^\s*image:\s*\S/.test(line));
    expect(imageLines.length).toBeGreaterThan(0);
    for (const line of imageLines) {
      if (/image:\s*\$\{/.test(line)) {
        continue;
      }
      expect(line).toMatch(/@sha256:[a-f0-9]{64}/);
    }
  });

  it('no bare upstream fetcher image reference (oven/bun is built, not pulled unpinned)', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    expect(compose).not.toMatch(/image:\s*oven\/bun/);
  });

  it('no image reference is pinned to :latest', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    expect(compose).not.toMatch(/image:\s*[^\s]+:latest\b/);
  });
});

describe('C-392 — dev engine services converge on the local stack (AC-1, AC-9)', () => {
  it('no per-service Dockerfile remains in text/image/voice', () => {
    for (const app of ['text', 'image', 'voice']) {
      expect(existsSync(join(ROOT, `../${app}/Dockerfile`))).toBe(false);
    }
  });

  it('compose.yaml is the only container topology — the stale docker-compose.yml is gone', () => {
    expect(existsSync(join(ROOT, 'compose.yaml'))).toBe(true);
    expect(existsSync(join(ROOT, 'docker-compose.yml'))).toBe(false);
  });

  it('the duplicated model downloaders are absent from text and image', () => {
    expect(existsSync(join(ROOT, '../text/scripts/download_model.ts'))).toBe(false);
    expect(existsSync(join(ROOT, '../image/scripts/download_model.ts'))).toBe(false);
    expect(existsSync(join(ROOT, '../image/scripts/download_models.ts'))).toBe(false);
  });

  it('no package.json or moon.yml in text/image references the removed downloaders', async () => {
    for (const app of ['text', 'image']) {
      const pkg = await readFile(join(ROOT, `../${app}/package.json`), 'utf8');
      const moon = await readFile(join(ROOT, `../${app}/moon.yml`), 'utf8');
      for (const needle of [
        'download_model',
        'download_models',
        'download:model',
        'models:download',
      ]) {
        expect(pkg).not.toContain(needle);
        expect(moon).not.toContain(needle);
      }
    }
  });

  it('no model weights are tracked under apps/backend/{text,image,voice}/src/', async () => {
    // Scoped to git-tracked files: untracked leftovers from the pre-C-392
    // ComfyUI tree (git-ignored) are handled by the migration script, not
    // by repo assertions — the dev services must not WRITE weights here.
    const weightExtensions = ['.gguf', '.safetensors', '.ckpt', '.bin', '.pth', '.pt', '.onnx'];
    const offenders: string[] = [];
    for (const app of ['text', 'image', 'voice']) {
      const srcDir = join(ROOT, `../${app}/src`);
      if (!existsSync(srcDir)) {
        continue;
      }
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (
            entry.isFile() &&
            weightExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext)) &&
            (await isTracked(full))
          ) {
            offenders.push(full);
          }
        }
      };
      await walk(srcDir);
    }
    expect(offenders).toEqual([]);
  });

  it('the dev start scripts delegate to the local-stack compose topology', async () => {
    for (const app of ['text', 'image', 'voice']) {
      const start = await readFile(join(ROOT, `../${app}/scripts/start.ts`), 'utf8');
      expect(start).toContain('local-stack');
      expect(start).toContain('compose');
    }
  });
});

describe('model manifest integrity', () => {
  it('models.manifest.json parses with verified entries', async () => {
    const manifest = JSON.parse(
      await readFile(join(ROOT, 'stack/models.manifest.json'), 'utf8'),
    ) as {
      schemaVersion: number;
      entries: Array<{
        id: string;
        modality: string;
        license: string;
        requiresAcknowledgement: boolean;
        kind: string;
        targetPath: string;
        bytes: number;
        sha256: string;
        companions?: { role: string; id: string }[];
      }>;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries.length).toBeGreaterThanOrEqual(7);
    const byId = new Map(manifest.entries.map((e) => [e.id, e]));
    for (const entry of manifest.entries) {
      expect(entry.id).toBeTruthy();
      expect(entry.targetPath).toBeTruthy();
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      // Every referenced companion must resolve to a real entry and share
      // the referencing entry's licence gate (a companion that silently
      // downloads ungated would defeat the acknowledgement it rides on).
      for (const companion of entry.companions ?? []) {
        const companionEntry = byId.get(companion.id);
        expect(companionEntry).toBeDefined();
        expect(companionEntry?.requiresAcknowledgement).toBe(entry.requiresAcknowledgement);
        expect(companionEntry?.license).toBe(entry.license);
      }
    }
    // The acknowledgement-gated entries exist and are correctly licensed
    // (SD 1.5 → OpenRAIL-M, Anima's diffusion model → its own non-commercial
    // licence, each ridden along by its companions).
    const acknowledged = manifest.entries.filter((e) => e.requiresAcknowledgement);
    expect(acknowledged.length).toBeGreaterThan(0);
    const sd15 = manifest.entries.find((e) => e.id === 'image-sd15-pruned-q4_0');
    expect(sd15?.license).toContain('OpenRAIL');
    const anima = manifest.entries.find((e) => e.id === 'image-anima-aesthetic-v1.1');
    expect(anima?.requiresAcknowledgement).toBe(true);
    expect(anima?.companions?.length).toBe(2);
  });
});
