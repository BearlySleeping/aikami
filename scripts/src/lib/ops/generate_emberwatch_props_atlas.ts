// scripts/src/lib/ops/generate_emberwatch_props_atlas.ts
//
// Packs the Emberwatch pack's approved prop artwork into irregular prop-atlas
// pages and validates the resulting frame namespace.
//
// Why this exists: the grid atlas is a fixed 16×8 grid of 32×32 cells with
// per-cell edge extrusion. Every approved prop is larger than 32×32 (the inn
// is 256×224, the ward tree 192×152, a table 96×42), so none of them can live
// there — per-cell extrusion would draw seams through a sprite spanning
// cells. Terrain stays in the grid atlas; oversized transparent props are
// packed here.
//
// Source of truth for the artwork is `content/packs/emberwatch/props/*.png`
// (standalone images, authoring-friendly). The packed pages are build output:
//   apps/frontend/client/static/game-data/sprites/tilesets/props.webp
//   apps/frontend/client/static/game-data/sprites/tilesets/props.json
// with `props-2.*`, `props-3.*` … added automatically once a page reaches the
// texture-size budget.
//
// Prop definitions reference stable frame names only — never a page index or
// atlas coordinates — so adding a page never touches a prop definition, a map
// or a save file.
//
// Run: bun scripts/src/lib/ops/generate_emberwatch_props_atlas.ts

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '$logger';
import { findDuplicateFrameNames, packPropAtlas } from './prop_atlas_packer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');

/** Standalone approved prop artwork — the authoring source of truth. */
const sourceDir = join(repository, 'content/packs/emberwatch/props');
/** Where the packed pages + the grid atlas live (served as game-data). */
const outDir = join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets');
/** Texture-size budget per page. Content-sized pages are emitted, not this. */
const MAX_PAGE_SIZE = 2048;

/** Frames the grid atlas already declares — used for the duplicate gate. */
const readAtlasFrameNames = (): string[] => {
  const atlasJson = JSON.parse(readFileSync(join(outDir, 'atlas.json'), 'utf8')) as {
    frames?: Record<string, unknown>;
  };
  return Object.keys(atlasJson.frames ?? {});
};

const main = async (): Promise<void> => {
  const files = readdirSync(sourceDir)
    .filter((name) => ['.png', '.webp'].includes(extname(name).toLowerCase()))
    .sort();

  if (files.length === 0) {
    throw new Error(`generate_emberwatch_props_atlas: no source images in ${sourceDir}`);
  }

  const sources = files.map((name) => ({
    name,
    bytes: new Uint8Array(readFileSync(join(sourceDir, name))),
  }));

  const pages = await packPropAtlas({
    sources,
    pageImageName: 'props.webp',
    appLabel: 'aikami-emberwatch-props',
    maxPageSize: MAX_PAGE_SIZE,
  });

  // ── Frame-namespace gate ────────────────────────────────────────────────
  // The grid atlas and every page share ONE flat namespace at runtime. A name
  // declared twice has no defined winner, so the build fails here rather than
  // shipping an ambiguous pack that the resolver would have to reject.
  const duplicates = findDuplicateFrameNames([
    { label: 'atlas', frames: readAtlasFrameNames() },
    ...pages.map((page, index) => ({ label: `props#${index}`, frames: page.frames })),
  ]);
  if (duplicates.length > 0) {
    throw new Error(
      `generate_emberwatch_props_atlas: duplicate frame name(s) across atlas sources — ` +
        duplicates.map((entry) => `"${entry.name}" (${entry.sources.join(', ')})`).join('; '),
    );
  }

  // ── Emit pages ──────────────────────────────────────────────────────────
  const emitted: { textureUrl: string; spritesheetUrl: string; frames: number; bytes: number }[] =
    [];
  pages.forEach((page, index) => {
    const stem = index === 0 ? 'props' : `props-${index + 1}`;
    const imageName = `${stem}.webp`;
    const jsonName = `${stem}.json`;
    // The page's own filename is what `meta.image` should name, regardless of
    // the caller-supplied default.
    const spritesheet = {
      ...page.spritesheet,
      meta: { ...page.spritesheet.meta, image: imageName },
    };
    writeFileSync(join(outDir, imageName), page.image);
    writeFileSync(join(outDir, jsonName), `${JSON.stringify(spritesheet, null, 2)}\n`);
    emitted.push({
      textureUrl: `/game-data/sprites/tilesets/${imageName}`,
      spritesheetUrl: `/game-data/sprites/tilesets/${jsonName}`,
      frames: page.frames.length,
      bytes: page.image.length,
    });
  });

  logger.info('generate_emberwatch_props_atlas:packed', {
    sources: sources.length,
    pages: emitted.length,
    totalBytes: emitted.reduce((sum, page) => sum + page.bytes, 0),
  });
  for (const [index, page] of emitted.entries()) {
    logger.info('generate_emberwatch_props_atlas:page', {
      page: index,
      textureUrl: page.textureUrl,
      frames: page.frames,
      bytes: page.bytes,
      dimensions: `${pages[index]?.width}×${pages[index]?.height}`,
    });
  }

  // Keep the manifest's `propAtlases` exactly in step with what was emitted.
  // A packer run that adds or drops a page must not leave the manifest
  // pointing at pages that no longer exist (or missing new ones) — that would
  // silently degrade every prop on the stale page to the fallback tile.
  const manifestPath = join(repository, 'content/packs/emberwatch/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    propAtlases?: { textureUrl: string; spritesheetUrl: string }[];
  };
  const declared = manifest.propAtlases ?? [];
  const emittedPages = emitted.map((page) => ({
    textureUrl: page.textureUrl,
    spritesheetUrl: page.spritesheetUrl,
  }));
  const sameAsEmitted =
    declared.length === emittedPages.length &&
    declared.every(
      (page, index) =>
        page.textureUrl === emittedPages[index]?.textureUrl &&
        page.spritesheetUrl === emittedPages[index]?.spritesheetUrl,
    );
  if (!sameAsEmitted) {
    manifest.propAtlases = emittedPages;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    logger.info('generate_emberwatch_props_atlas:manifest-updated', {
      manifestPath,
      pages: emittedPages.length,
    });
  }

  // Machine-readable summary for CI checks.
  writeFileSync(
    join(outDir, 'props.pages.json'),
    `${JSON.stringify(
      {
        app: 'aikami-emberwatch-props',
        maxPageSize: MAX_PAGE_SIZE,
        pages: emitted.map((page) => ({
          textureUrl: page.textureUrl,
          spritesheetUrl: page.spritesheetUrl,
        })),
        frames: pages.flatMap((page) => page.frames).sort(),
      },
      null,
      2,
    )}\n`,
  );
};

await main();
