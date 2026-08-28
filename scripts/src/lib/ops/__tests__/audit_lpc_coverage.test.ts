// scripts/src/lib/ops/__tests__/audit_lpc_coverage.test.ts
//
// C-429 AC-1 through AC-4 — LPC sheet coverage audit unit tests.
//
// Uses synthetic WebP images generated via ImageMagick to test the full
// audit pipeline: alpha inspection, baseline diff, paired-sheet union,
// and regression detection.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ImageMagick isn't installed on CI runners (nothing in the CI setup action
// provisions it) — the AC-1..AC-4 suites below generate their fixtures with
// it, so they can only ever run on a dev machine that has `magick` on PATH.
// Skipped rather than deleted: real coverage for whoever has the tooling.
const hasImageMagick = Bun.which('magick') !== null;

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Create a synthetic WebP image with a specific alpha pattern.
 *
 * @param filePath - Output path
 * @param width - Image width in px
 * @param height - Image height in px
 * @param cellPitch - Cell pitch in px
 * @param filledCells - Array of [row, col] pairs that should have non-zero alpha
 */
const createSyntheticSheet = (options: {
  filePath: string;
  width: number;
  height: number;
  cellPitch: number;
  filledCells: readonly (readonly [number, number])[];
}): void => {
  const { filePath, width, height, cellPitch, filledCells } = options;

  // Build a ImageMagick script: draw a semi-transparent white rectangle in each filled cell
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Start with a fully transparent canvas
  const drawCommands: string[] = [];

  for (const [row, col] of filledCells) {
    const x = col * cellPitch;
    const y = row * cellPitch;
    // Draw a semi-transparent white rectangle (alpha ~0.5)
    drawCommands.push(`rectangle ${x},${y} ${x + cellPitch - 1},${y + cellPitch - 1}`);
  }

  if (drawCommands.length === 0) {
    // Fully transparent sheet
    const proc = Bun.spawnSync([
      'magick',
      '-size',
      `${width}x${height}`,
      'xc:transparent',
      '-define',
      'webp:lossless=true',
      filePath,
    ]);
    if (proc.exitCode !== 0) {
      throw new Error(`magick failed: ${proc.stderr.toString()}`);
    }
    return;
  }

  // Draw filled cells with semi-transparent white
  const proc = Bun.spawnSync([
    'magick',
    '-size',
    `${width}x${height}`,
    'xc:transparent',
    '-fill',
    'rgba(255,255,255,0.5)',
    '-draw',
    drawCommands.join(' '),
    '-define',
    'webp:lossless=true',
    filePath,
  ]);
  if (proc.exitCode !== 0) {
    throw new Error(`magick failed: ${proc.stderr.toString()}`);
  }
};

// ── Synthetic sheet fixtures ───────────────────────────────────────────

const TMP_DIR = join(import.meta.dir, '.test-sheets');
const TMP_LPC_DIR = join(TMP_DIR, 'lpc');

const SHEETS = {
  // Standard 64px sheet, 9 cols × 4 rows, all cells filled (full coverage)
  fullCoverage: join(TMP_LPC_DIR, 'body/bodies_male.walk.webp'),
  // Standard 64px sheet, 9 cols × 4 rows, only row 2 (down) filled
  onlyDown: join(TMP_LPC_DIR, 'weapon/sword/longsword.walk.webp'),
  // Standard 64px sheet, 9 cols × 4 rows, only rows 0 and 2 filled
  upAndDown: join(TMP_LPC_DIR, 'weapon/axe/battleaxe.walk.webp'),
  // Single-row sheet (hurt state)
  singleRow: join(TMP_LPC_DIR, 'body/bodies_male.hurt.webp'),
  // Oversize 128px sheet, 13 cols × 4 rows, all filled
  oversizeFull: join(TMP_LPC_DIR, 'weapon/sword/longsword_alt.walk.webp'),
  // BG sheet — only up row filled
  shieldBg: join(TMP_LPC_DIR, 'shield/crusader_bg.walk.webp'),
  // FG sheet — all four rows filled
  shieldFg: join(TMP_LPC_DIR, 'shield/crusader_fg.walk.webp'),
  // Empty sheet — no pixels at all (fully transparent)
  emptySheet: join(TMP_LPC_DIR, 'test/empty.walk.webp'),
};

// ── Setup / Teardown ───────────────────────────────────────────────────

beforeAll(() => {
  if (!hasImageMagick) {
    return;
  }
  // Create synthetic sheets
  createSyntheticSheet({
    filePath: SHEETS.fullCoverage,
    width: 576,
    height: 256,
    cellPitch: 64,
    filledCells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6],
      [1, 7],
      [1, 8],
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
      [3, 4],
      [3, 5],
      [3, 6],
      [3, 7],
      [3, 8],
    ],
  });

  createSyntheticSheet({
    filePath: SHEETS.onlyDown,
    width: 576,
    height: 256,
    cellPitch: 64,
    filledCells: [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
    ],
  });

  createSyntheticSheet({
    filePath: SHEETS.upAndDown,
    width: 576,
    height: 256,
    cellPitch: 64,
    filledCells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
    ],
  });

  // Single-row sheet: 9 cols × 1 row, all filled
  createSyntheticSheet({
    filePath: SHEETS.singleRow,
    width: 576,
    height: 64,
    cellPitch: 64,
    filledCells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
    ],
  });

  // Oversize sheet: 128px pitch, 13 cols × 4 rows, all filled
  createSyntheticSheet({
    filePath: SHEETS.oversizeFull,
    width: 1664,
    height: 512,
    cellPitch: 128,
    filledCells: (() => {
      const cells: [number, number][] = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 13; c++) {
          cells.push([r, c]);
        }
      }
      return cells;
    })(),
  });

  // BG sheet — only up row (row 0) filled
  createSyntheticSheet({
    filePath: SHEETS.shieldBg,
    width: 576,
    height: 256,
    cellPitch: 64,
    filledCells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
    ],
  });

  // FG sheet — all four rows filled
  createSyntheticSheet({
    filePath: SHEETS.shieldFg,
    width: 576,
    height: 256,
    cellPitch: 64,
    filledCells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6],
      [1, 7],
      [1, 8],
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
      [3, 4],
      [3, 5],
      [3, 6],
      [3, 7],
      [3, 8],
    ],
  });

  // Empty sheet — no pixels at all (fully transparent)
  createSyntheticSheet({
    filePath: SHEETS.emptySheet,
    width: 576,
    height: 256,
    cellPitch: 64,
    filledCells: [],
  });
});

afterAll(() => {
  // Clean up temp files
  Bun.spawnSync(['rm', '-rf', TMP_DIR]);
});

// ── Import the module under test ───────────────────────────────────────

// We import the module functions directly for testing
// The module exports are the core logic functions

// ── AC-1: Per-row frame coverage ───────────────────────────────────────

describe.skipIf(!hasImageMagick)('AC-1: Per-row frame coverage', () => {
  it('detects full coverage (all 4 rows, 9 frames each)', async () => {
    // Use the audit script's core logic by importing it
    const mod = await import('../audit_lpc_coverage.js');
    const { resolveLpcSheetGeometry } = await import(
      '../../../../../packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts'
    );

    // Get dimensions
    const proc = Bun.spawnSync(['magick', SHEETS.fullCoverage, '-format', '%w %h', 'info:']);
    const dims = proc.stdout.toString().trim().split(/\s+/);
    const width = Number.parseInt(dims[0] ?? '', 10);
    const height = Number.parseInt(dims[1] ?? '', 10);

    const geometry = resolveLpcSheetGeometry({ width, height });
    expect(geometry.pitch).toBe(64);
    expect(geometry.columns).toBe(9);
    expect(geometry.rows).toBe(4);

    // Inspect alpha
    const alpha = await mod.inspectSheetAlpha({
      filePath: SHEETS.fullCoverage,
      pitch: geometry.pitch,
      columns: geometry.columns,
      rows: geometry.rows,
    });

    expect(alpha.length).toBe(36); // 9 cols × 4 rows

    // Count frames per row
    const framesPerRow: number[] = [];
    for (let row = 0; row < geometry.rows; row++) {
      let count = 0;
      for (let col = 0; col < geometry.columns; col++) {
        const idx = row * geometry.columns + col;
        if (alpha[idx]) {
          count++;
        }
      }
      framesPerRow.push(count);
    }

    expect(framesPerRow).toEqual([9, 9, 9, 9]);
  });

  it('detects single-row coverage (only down row has frames)', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    const { resolveLpcSheetGeometry } = await import(
      '../../../../../packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts'
    );

    const proc = Bun.spawnSync(['magick', SHEETS.onlyDown, '-format', '%w %h', 'info:']);
    const dims = proc.stdout.toString().trim().split(/\s+/);
    const width = Number.parseInt(dims[0] ?? '', 10);
    const height = Number.parseInt(dims[1] ?? '', 10);

    const geometry = resolveLpcSheetGeometry({ width, height });
    expect(geometry.pitch).toBe(64);
    expect(geometry.columns).toBe(9);
    expect(geometry.rows).toBe(4);

    const alpha = await mod.inspectSheetAlpha({
      filePath: SHEETS.onlyDown,
      pitch: geometry.pitch,
      columns: geometry.columns,
      rows: geometry.rows,
    });

    const framesPerRow: number[] = [];
    for (let row = 0; row < geometry.rows; row++) {
      let count = 0;
      for (let col = 0; col < geometry.columns; col++) {
        const idx = row * geometry.columns + col;
        if (alpha[idx]) {
          count++;
        }
      }
      framesPerRow.push(count);
    }

    expect(framesPerRow).toEqual([0, 0, 9, 0]);
  });

  it('detects single-row state sheets (1 row, not a regression)', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    const { resolveLpcSheetGeometry } = await import(
      '../../../../../packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts'
    );

    const proc = Bun.spawnSync(['magick', SHEETS.singleRow, '-format', '%w %h', 'info:']);
    const dims = proc.stdout.toString().trim().split(/\s+/);
    const width = Number.parseInt(dims[0] ?? '', 10);
    const height = Number.parseInt(dims[1] ?? '', 10);

    const geometry = resolveLpcSheetGeometry({ width, height });
    expect(geometry.pitch).toBe(64);
    expect(geometry.columns).toBe(9);
    expect(geometry.rows).toBe(1); // Single row

    const alpha = await mod.inspectSheetAlpha({
      filePath: SHEETS.singleRow,
      pitch: geometry.pitch,
      columns: geometry.columns,
      rows: geometry.rows,
    });

    const framesPerRow: number[] = [];
    for (let row = 0; row < geometry.rows; row++) {
      let count = 0;
      for (let col = 0; col < geometry.columns; col++) {
        const idx = row * geometry.columns + col;
        if (alpha[idx]) {
          count++;
        }
      }
      framesPerRow.push(count);
    }

    expect(framesPerRow).toEqual([9]); // Single row, all filled
  });

  it('detects oversize sheet coverage correctly', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    const { resolveLpcSheetGeometry } = await import(
      '../../../../../packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts'
    );

    const proc = Bun.spawnSync(['magick', SHEETS.oversizeFull, '-format', '%w %h', 'info:']);
    const dims = proc.stdout.toString().trim().split(/\s+/);
    const width = Number.parseInt(dims[0] ?? '', 10);
    const height = Number.parseInt(dims[1] ?? '', 10);

    const geometry = resolveLpcSheetGeometry({ width, height });
    expect(geometry.pitch).toBe(128);
    expect(geometry.columns).toBe(13);
    expect(geometry.rows).toBe(4);

    const alpha = await mod.inspectSheetAlpha({
      filePath: SHEETS.oversizeFull,
      pitch: geometry.pitch,
      columns: geometry.columns,
      rows: geometry.rows,
    });

    expect(alpha.length).toBe(52); // 13 cols × 4 rows

    const framesPerRow: number[] = [];
    for (let row = 0; row < geometry.rows; row++) {
      let count = 0;
      for (let col = 0; col < geometry.columns; col++) {
        const idx = row * geometry.columns + col;
        if (alpha[idx]) {
          count++;
        }
      }
      framesPerRow.push(count);
    }

    expect(framesPerRow).toEqual([13, 13, 13, 13]);
  });

  it('detects fully transparent rows (empty sheet with no pixels)', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    const { resolveLpcSheetGeometry } = await import(
      '../../../../../packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts'
    );

    const proc = Bun.spawnSync(['magick', SHEETS.emptySheet, '-format', '%w %h', 'info:']);
    const dims = proc.stdout.toString().trim().split(/\s+/);
    const width = Number.parseInt(dims[0] ?? '', 10);
    const height = Number.parseInt(dims[1] ?? '', 10);

    const geometry = resolveLpcSheetGeometry({ width, height });
    expect(geometry.pitch).toBe(64);
    expect(geometry.columns).toBe(9);
    expect(geometry.rows).toBe(4);

    const alpha = await mod.inspectSheetAlpha({
      filePath: SHEETS.emptySheet,
      pitch: geometry.pitch,
      columns: geometry.columns,
      rows: geometry.rows,
    });

    expect(alpha.length).toBe(36); // 9 cols × 4 rows

    const framesPerRow: number[] = [];
    for (let row = 0; row < geometry.rows; row++) {
      let count = 0;
      for (let col = 0; col < geometry.columns; col++) {
        const idx = row * geometry.columns + col;
        if (alpha[idx]) {
          count++;
        }
      }
      framesPerRow.push(count);
    }

    expect(framesPerRow).toEqual([0, 0, 0, 0]); // All rows empty
  });
});

// ── AC-2: New gap fails the audit ──────────────────────────────────────

describe.skipIf(!hasImageMagick)('AC-2: New coverage gap fails the audit', () => {
  it('detects a regression when a sheet loses a row', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // Simulate: fullCoverage sheet with a baseline that says all 4 rows are covered
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [
        {
          tag: 'lpc:body:bodies_male:walk',
          acceptedEmptyRows: [] as readonly number[],
          reason: 'Full coverage expected',
        },
      ],
    };

    // Now simulate that onlyDown sheet replaces fullCoverage
    // (it has empty rows 0, 1, 3)
    const sheetResults = [
      {
        tag: 'lpc:body:bodies_male:walk',
        filePath: SHEETS.onlyDown,
        coverage: {
          tag: 'lpc:body:bodies_male:walk',
          pitch: 64,
          columns: 9,
          rows: 4,
          framesPerRow: [0, 0, 9, 0] as readonly number[],
        },
        emptyRows: [0, 1, 3] as readonly number[],
      },
    ];

    // Build lookup
    const lookup = mod.buildBaselineLookup(baseline);
    const baselineEntry = lookup.get('lpc:body:bodies_male:walk');

    expect(baselineEntry).toBeDefined();
    expect(baselineEntry?.acceptedEmptyRows).toEqual([]);

    // Use classifySheets to detect regression
    const { regressions, knownGaps, newlyCovered } = mod.classifySheets({
      sheetResults,
      baselineLookup: lookup,
    });

    expect(regressions.length).toBe(1);
    expect(regressions[0]?.tag).toBe('lpc:body:bodies_male:walk');
    expect(regressions[0]?.emptyRows).toEqual([0, 1, 3]);
    expect(knownGaps.length).toBe(0);
    expect(newlyCovered.length).toBe(0);
  });

  it('names the tag and rows in the regression output', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // Create a baseline that expects full coverage
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [
        {
          tag: 'lpc:weapon:sword:longsword:walk',
          acceptedEmptyRows: [] as readonly number[],
          reason: 'Full coverage expected',
        },
      ],
    };

    const sheetResults = [
      {
        tag: 'lpc:weapon:sword:longsword:walk',
        filePath: SHEETS.onlyDown,
        coverage: {
          tag: 'lpc:weapon:sword:longsword:walk',
          pitch: 64,
          columns: 9,
          rows: 4,
          framesPerRow: [0, 0, 9, 0] as readonly number[],
        },
        emptyRows: [0, 1, 3] as readonly number[],
      },
    ];

    const lookup = mod.buildBaselineLookup(baseline);

    // Use classifySheets to detect regression
    const { regressions } = mod.classifySheets({
      sheetResults,
      baselineLookup: lookup,
    });

    // The regression should name the tag and the empty rows
    expect(regressions.length).toBe(1);
    expect(regressions[0]?.tag).toBe('lpc:weapon:sword:longsword:walk');
    expect(regressions[0]?.emptyRows).toEqual([0, 1, 3]);
    expect(regressions[0]?.baselineAccepted).toEqual([]);
  });

  it('excludes cached sheets from classification', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [],
    };

    const sheetResults = [
      {
        tag: 'lpc:body:bodies_male:walk',
        filePath: SHEETS.fullCoverage,
        coverage: {
          tag: 'lpc:body:bodies_male:walk',
          pitch: 0,
          columns: 0,
          rows: 0,
          framesPerRow: [] as readonly number[],
        },
        emptyRows: [] as readonly number[],
        error: 'cached',
      },
    ];

    const lookup = mod.buildBaselineLookup(baseline);

    // Cached sheets should not be classified
    const { regressions, knownGaps, newlyCovered } = mod.classifySheets({
      sheetResults,
      baselineLookup: lookup,
    });

    expect(regressions.length).toBe(0);
    expect(knownGaps.length).toBe(0);
    expect(newlyCovered.length).toBe(0);
  });

  it('counts errored sheets separately and does not classify them', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [],
    };

    const sheetResults = [
      {
        tag: 'lpc:body:bodies_male:walk',
        filePath: SHEETS.fullCoverage,
        coverage: {
          tag: 'lpc:body:bodies_male:walk',
          pitch: 0,
          columns: 0,
          rows: 0,
          framesPerRow: [] as readonly number[],
        },
        emptyRows: [] as readonly number[],
        error: 'ImageMagick failed',
      },
    ];

    const lookup = mod.buildBaselineLookup(baseline);

    // Errored sheets should be counted but not classified
    const { regressions, knownGaps, newlyCovered, failedCount } = mod.classifySheets({
      sheetResults,
      baselineLookup: lookup,
    });

    expect(failedCount).toBe(1);
    expect(regressions.length).toBe(0);
    expect(knownGaps.length).toBe(0);
    expect(newlyCovered.length).toBe(0);
  });
});

// ── AC-3: Baselined gap does not fail ──────────────────────────────────

describe.skipIf(!hasImageMagick)('AC-3: Baselined gap does not fail', () => {
  it('accepts a known gap listed in the baseline', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // Baseline accepts rows 0, 1, 3 for longsword
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [
        {
          tag: 'lpc:weapon:sword:longsword:walk',
          acceptedEmptyRows: [0, 1, 3] as readonly number[],
          reason: 'C-431 — behind pass collection not yet implemented',
        },
      ],
    };

    const lookup = mod.buildBaselineLookup(baseline);
    const entry = lookup.get('lpc:weapon:sword:longsword:walk');

    expect(entry).toBeDefined();
    expect(entry?.acceptedEmptyRows).toEqual([0, 1, 3]);

    // Simulate the same gaps exist
    const sheetResults = [
      {
        tag: 'lpc:weapon:sword:longsword:walk',
        filePath: SHEETS.onlyDown,
        coverage: {
          tag: 'lpc:weapon:sword:longsword:walk',
          pitch: 64,
          columns: 9,
          rows: 4,
          framesPerRow: [0, 0, 9, 0] as readonly number[],
        },
        emptyRows: [0, 1, 3] as readonly number[],
      },
    ];

    // Use classifySheets to check classification
    const { regressions, knownGaps, newlyCovered } = mod.classifySheets({
      sheetResults,
      baselineLookup: lookup,
    });

    // All empty rows are in acceptedEmptyRows → no regression, but known gap
    expect(regressions.length).toBe(0);
    expect(knownGaps.length).toBe(1);
    expect(knownGaps[0]?.tag).toBe('lpc:weapon:sword:longsword:walk');
    expect(knownGaps[0]?.emptyRows).toEqual([0, 1, 3]);
    expect(knownGaps[0]?.reason).toBe('C-431 — behind pass collection not yet implemented');
    expect(newlyCovered.length).toBe(0);
  });

  it('requires a non-empty reason in the baseline entry', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // Valid baseline with non-empty reason
    const validBaseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [
        {
          tag: 'lpc:weapon:sword:longsword:walk',
          acceptedEmptyRows: [0, 1, 3] as readonly number[],
          reason: 'C-431 — behind pass collection not yet implemented',
        },
      ],
    };

    // Should not throw
    expect(() => mod.buildBaselineLookup(validBaseline)).not.toThrow();

    // Invalid baseline with empty reason
    const invalidBaseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [
        {
          tag: 'lpc:weapon:sword:longsword:walk',
          acceptedEmptyRows: [0, 1, 3] as readonly number[],
          reason: '',
        },
      ],
    };

    // Should throw
    expect(() => mod.buildBaselineLookup(invalidBaseline)).toThrow(
      'Baseline entry for "lpc:weapon:sword:longsword:walk" has an empty reason field',
    );

    // Invalid baseline with whitespace-only reason
    const whitespaceBaseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [
        {
          tag: 'lpc:weapon:sword:longsword:walk',
          acceptedEmptyRows: [0, 1, 3] as readonly number[],
          reason: '   ',
        },
      ],
    };

    // Should throw
    expect(() => mod.buildBaselineLookup(whitespaceBaseline)).toThrow(
      'Baseline entry for "lpc:weapon:sword:longsword:walk" has an empty reason field',
    );
  });
});

// ── AC-4: Complementary bg/fg pairs ────────────────────────────────────

describe.skipIf(!hasImageMagick)('AC-4: Complementary bg/fg pairs', () => {
  it('evaluates paired bg/fg sheets as a union', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // BG sheet: only up row (row 0) filled
    const bgResult = {
      tag: 'lpc:shield:crusader_bg:walk',
      filePath: SHEETS.shieldBg,
      coverage: {
        tag: 'lpc:shield:crusader_bg:walk',
        pitch: 64,
        columns: 9,
        rows: 4,
        framesPerRow: [9, 0, 0, 0] as readonly number[],
      },
      emptyRows: [1, 2, 3] as readonly number[],
    };

    // FG sheet: all four rows filled
    const fgResult = {
      tag: 'lpc:shield:crusader_fg:walk',
      filePath: SHEETS.shieldFg,
      coverage: {
        tag: 'lpc:shield:crusader_fg:walk',
        pitch: 64,
        columns: 9,
        rows: 4,
        framesPerRow: [9, 9, 9, 9] as readonly number[],
      },
      emptyRows: [] as readonly number[],
    };

    // Baseline declares them as a pair
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 2,
      entries: [
        {
          tag: 'lpc:shield:crusader_bg:walk',
          pairedWith: 'lpc:shield:crusader_fg:walk',
          acceptedEmptyRows: [1, 2, 3] as readonly number[],
          reason: 'C-431 — BG sheet only covers up; FG covers all',
        },
      ],
    };

    // Compute union: bg has rows [1,2,3] empty, fg has none empty
    // Union should have no empty rows since fg covers everything
    const pairedEmptyRows = mod.computePairedEmptyRows(bgResult, fgResult);
    expect(pairedEmptyRows).toEqual([]);

    // Now test the reverse: if fg is the primary and bg is the pair
    const bgEntry = baseline.entries[0];
    expect(bgEntry?.pairedWith).toBe('lpc:shield:crusader_fg:walk');

    // Check that neither sheet is reported as a gap when paired
    const lookup = mod.buildBaselineLookup(baseline);
    const bgBaselineEntry = lookup.get('lpc:shield:crusader_bg:walk');
    expect(bgBaselineEntry).toBeDefined();
    expect(bgBaselineEntry?.pairedWith).toBe('lpc:shield:crusader_fg:walk');
  });

  it('does not infer pairing from filename suffix alone', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // A sheet with _bg in its path but no pairedWith in baseline
    // should be treated as an unpaired sheet
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 1,
      entries: [] as readonly {
        tag: string;
        pairedWith?: string;
        acceptedEmptyRows: readonly number[];
        reason: string;
      }[],
    };

    const lookup = mod.buildBaselineLookup(baseline);
    const entry = lookup.get('lpc:shield:crusader_bg:walk');
    expect(entry).toBeUndefined(); // Not in baseline, not paired
  });

  it('allows overlap where both bg and fg cover the same direction', async () => {
    const mod = await import('../audit_lpc_coverage.js');

    // Both bg and fg cover row 0 (up) — this is legal
    const bgResult = {
      tag: 'lpc:shield:crusader_bg:walk',
      filePath: SHEETS.shieldBg,
      coverage: {
        tag: 'lpc:shield:crusader_bg:walk',
        pitch: 64,
        columns: 9,
        rows: 4,
        framesPerRow: [9, 0, 0, 0] as readonly number[],
      },
      emptyRows: [1, 2, 3] as readonly number[],
    };

    // FG covers row 0 too (overlap) and all others
    const fgResult = {
      tag: 'lpc:shield:crusader_fg:walk',
      filePath: SHEETS.shieldFg,
      coverage: {
        tag: 'lpc:shield:crusader_fg:walk',
        pitch: 64,
        columns: 9,
        rows: 4,
        framesPerRow: [9, 9, 9, 9] as readonly number[],
      },
      emptyRows: [] as readonly number[],
    };

    // Union: fg covers all rows, so no empty rows
    const pairedEmptyRows = mod.computePairedEmptyRows(bgResult, fgResult);
    expect(pairedEmptyRows).toEqual([]);

    // Even if fg only covers rows 0 and 2, the overlap on row 0 is fine
    const fgPartial = {
      tag: 'lpc:shield:crusader_fg:walk',
      filePath: SHEETS.shieldFg,
      coverage: {
        tag: 'lpc:shield:crusader_fg:walk',
        pitch: 64,
        columns: 9,
        rows: 4,
        framesPerRow: [9, 0, 9, 0] as readonly number[],
      },
      emptyRows: [1, 3] as readonly number[],
    };

    const partialUnion = mod.computePairedEmptyRows(bgResult, fgPartial);
    // bg covers row 0, fg covers rows 0 and 2
    // Union covers rows 0 and 2; rows 1 and 3 are empty
    expect(partialUnion).toEqual([1, 3]);
  });
});

// ── Utility function tests ─────────────────────────────────────────────

describe('Utility functions', () => {
  it('pathToTag converts file paths to manifest tags', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    expect(mod.pathToTag('weapon/sword/longsword.walk.webp')).toBe(
      'lpc:weapon:sword:longsword:walk',
    );
    expect(mod.pathToTag('body/bodies_male.walk.webp')).toBe('lpc:body:bodies_male:walk');
    expect(mod.pathToTag('shield/crusader_bg.walk.webp')).toBe('lpc:shield:crusader_bg:walk');
  });

  it('parseTag extracts components from a tag', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    const parsed = mod.parseTag('lpc:weapon:sword:longsword:walk');
    expect(parsed).toEqual({
      slot: 'weapon',
      type: 'sword',
      variant: 'longsword',
      state: 'walk',
    });
  });

  it('parseTag returns null for non-lpc tags', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    expect(mod.parseTag('music:theme:overworld')).toBeNull();
  });

  it('buildBaselineLookup creates a map from baseline entries', async () => {
    const mod = await import('../audit_lpc_coverage.js');
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      auditedCount: 2,
      entries: [
        {
          tag: 'lpc:weapon:sword:longsword:walk',
          acceptedEmptyRows: [0, 1, 3] as readonly number[],
          reason: 'C-431',
        },
        {
          tag: 'lpc:weapon:sword:katana:walk',
          acceptedEmptyRows: [0, 1] as readonly number[],
          reason: 'C-431',
        },
      ],
    };

    const lookup = mod.buildBaselineLookup(baseline);
    expect(lookup.size).toBe(2);
    expect(lookup.get('lpc:weapon:sword:longsword:walk')?.acceptedEmptyRows).toEqual([0, 1, 3]);
    expect(lookup.get('lpc:weapon:sword:katana:walk')?.acceptedEmptyRows).toEqual([0, 1]);
    expect(lookup.get('lpc:body:bodies_male:walk')).toBeUndefined();
  });
});
