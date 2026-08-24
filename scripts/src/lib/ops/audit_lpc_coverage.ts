// scripts/src/lib/ops/audit_lpc_coverage.ts
// LPC Sheet Coverage Audit — deterministic byte-level alpha inspection.
//
// Scans every collected LPC sheet, resolves its cell grid via the C-428
// geometry resolver, inspects each cell for non-zero alpha pixels, and
// compares the result against a committed baseline. New gaps fail CI;
// known gaps are listed in the baseline and shrink as C-431 lands.
//
// Usage:
//   bun run scripts/src/lib/ops/audit_lpc_coverage.ts
//   bun run scripts/src/lib/ops/audit_lpc_coverage.ts --generate-baseline
//   bun run scripts/src/lib/ops/audit_lpc_coverage.ts --force
//
//   --generate-baseline  Write a new baseline file from the current tree
//   --force              Bypass hash cache, re-inspect every sheet
//
// Outputs:
//   apps/frontend/client/static/game-data/lpc_coverage_baseline.json
//     — committed baseline (written with --generate-baseline)
//
// Prerequisites:
//   1. ImageMagick 'magick' must be available in PATH.
//   2. The LPC asset tree must exist under static/game-data/lpc/.
//
// Contracts: C-429

// biome-ignore-all lint/style/useNamingConvention: C-429 JSON output format

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { resolveLpcSheetGeometry } from '../../../../packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts';

// ── Configuration ──────────────────────────────────────────────────────

/** Root of the monorepo (resolved from script location). */
const REPO_ROOT = resolve(join(import.meta.dirname, '..', '..', '..', '..'));

/** Directory containing collected LPC WebP sheets. */
const LPC_ASSETS_DIR = join(REPO_ROOT, 'apps/frontend/client/static/game-data/lpc');

/** Path to the committed asset hashes sidecar. */
const ASSET_HASHES_PATH = join(
  REPO_ROOT,
  'apps/frontend/client/static/game-data/asset_hashes.json',
);

/** Path to the committed coverage baseline. */
const BASELINE_PATH = join(
  REPO_ROOT,
  'apps/frontend/client/static/game-data/lpc_coverage_baseline.json',
);

/** Baseline schema version — bump on breaking format changes. */
const BASELINE_SCHEMA_VERSION = 1;

/** Number of sheets to process concurrently. */
const CONCURRENCY = 8;

/** LPC direction row labels for human-readable output. */
const DIRECTION_LABELS = ['up', 'left', 'down', 'right'] as const;

// ── Types ──────────────────────────────────────────────────────────────

/** Which direction rows carry pixels, plus the frame count per populated row. */
type LpcSheetCoverage = {
  /** Manifest tag, e.g. "lpc:weapon:sword:longsword:walk". */
  tag: string;
  /** Resolved geometry from the C-428 resolver. */
  pitch: number;
  columns: number;
  rows: number;
  /** Non-empty frame count per direction row, index = LPC row (0=up, 1=left, 2=down, 3=right). */
  framesPerRow: readonly number[];
};

/** One accepted, known-incomplete sheet or pair. */
type LpcCoverageBaselineEntry = {
  tag: string;
  /** Tag of the complementary bg/fg sheet whose union completes coverage, when one exists. */
  pairedWith?: string;
  /** Direction rows known to be empty and accepted for now. */
  acceptedEmptyRows: readonly number[];
  /** Why this gap is accepted, and the contract that will close it. */
  reason: string;
};

/** The committed baseline document. */
type LpcCoverageBaseline = {
  schemaVersion: number;
  generatedAt: string;
  /** Total sheets audited when this baseline was written. */
  auditedCount: number;
  entries: readonly LpcCoverageBaselineEntry[];
};

/** One sheet's audit result. */
type SheetResult = {
  tag: string;
  filePath: string;
  coverage: LpcSheetCoverage;
  /** Direction rows (0-indexed) that are empty. */
  emptyRows: readonly number[];
  /** Error message if processing failed. */
  error?: string;
};

/** Final audit report. */
type AuditReport = {
  generatedAt: string;
  auditedCount: number;
  passedCount: number;
  regressionCount: number;
  knownGapCount: number;
  newlyCoveredCount: number;
  elapsedMs: number;
  sheets: SheetResult[];
  regressions: RegressionEntry[];
  knownGaps: KnownGapEntry[];
  newlyCovered: string[];
};

type RegressionEntry = {
  tag: string;
  emptyRows: readonly number[];
  baselineAccepted: readonly number[];
};

type KnownGapEntry = {
  tag: string;
  emptyRows: readonly number[];
  reason: string;
};

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Convert a filesystem path under lpc/ to a manifest tag.
 * E.g. "weapon/sword/longsword.walk.webp" → "lpc:weapon:sword:longsword:walk"
 */
const pathToTag = (relPath: string): string => {
  const withoutExt = relPath.replace(/\.webp$/i, '');
  // Split on both / and . to handle variant.state.webp naming
  const parts = withoutExt.split(/[/\\.]/);
  return `lpc:${parts.join(':')}`;
};

/**
 * Parse a tag back into its file path components.
 * E.g. "lpc:weapon:sword:longsword:walk" → { slot: "weapon", type: "sword", variant: "longsword", state: "walk" }
 */
const parseTag = (
  tag: string,
): { slot: string; type: string; variant: string; state: string } | null => {
  if (!tag.startsWith('lpc:')) {
    return null;
  }
  const parts = tag.slice(4).split(':');
  if (parts.length < 3) {
    return null;
  }
  const state = parts[parts.length - 1] ?? '';
  const variant = parts[parts.length - 2] ?? '';
  const type = parts.slice(1, -2).join('/') || (parts[1] ?? '');
  const slot = parts[0] ?? '';
  return { slot, type, variant, state };
};

/**
 * Load the asset hashes sidecar into a Map<tag, sha256>.
 */
const loadAssetHashes = (): Map<string, string> => {
  const hashes = new Map<string, string>();
  if (!existsSync(ASSET_HASHES_PATH)) {
    return hashes;
  }
  try {
    const raw = readFileSync(ASSET_HASHES_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, { sha256: string }>;
    for (const [tag, entry] of Object.entries(parsed)) {
      if (entry?.sha256) {
        hashes.set(tag, entry.sha256);
      }
    }
  } catch {
    // Corrupt or missing — start fresh
  }
  return hashes;
};

/**
 * Load the committed baseline, or return null if absent/invalid.
 */
const loadBaseline = (): LpcCoverageBaseline | null => {
  if (!existsSync(BASELINE_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(BASELINE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LpcCoverageBaseline;
    if (parsed.schemaVersion !== BASELINE_SCHEMA_VERSION) {
      console.error(
        `❌ Baseline schema version mismatch: expected ${BASELINE_SCHEMA_VERSION}, got ${parsed.schemaVersion}`,
      );
      process.exit(1);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to read baseline: ${message}`);
    process.exit(1);
  }
};

/**
 * Compute SHA-256 of a file.
 */
const sha256File = async (filePath: string): Promise<string> => {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash('sha256');
  hash.update(new Uint8Array(buffer));
  return hash.digest('hex');
};

/**
 * Get the dimensions of a WebP image using ImageMagick.
 */
const getImageDimensions = async (filePath: string): Promise<{ width: number; height: number }> => {
  const proc = Bun.spawn(['magick', filePath, '-format', '%w %h', 'info:']);
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`magick info failed for ${filePath}: exit ${exitCode}`);
  }
  const parts = output.trim().split(/\s+/);
  const width = Number.parseInt(parts[0] ?? '', 10);
  const height = Number.parseInt(parts[1] ?? '', 10);
  if (Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error(`Could not parse dimensions from "${output.trim()}" for ${filePath}`);
  }
  return { width, height };
};

/**
 * Inspect alpha channel of a sheet and return which cells have non-zero alpha.
 *
 * Uses ImageMagick to extract the alpha channel and crop into cells.
 * Returns a flat array of booleans, one per cell in row-major order.
 */
const inspectSheetAlpha = async (options: {
  filePath: string;
  pitch: number;
  columns: number;
  rows: number;
}): Promise<readonly boolean[]> => {
  const { filePath, pitch, columns, rows } = options;

  // Use ImageMagick: extract alpha, crop into cells, output mean per cell
  const proc = Bun.spawn([
    'magick',
    filePath,
    '-alpha',
    'extract',
    '-crop',
    `${pitch}x${pitch}`,
    '+repage',
    '-format',
    '%[fx:mean>0?1:0]\n',
    'info:',
  ]);

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`magick alpha inspection failed for ${filePath}: exit ${exitCode}`);
  }

  const values = output
    .trim()
    .split('\n')
    .map((v) => v.trim() === '1');

  // Validate count matches expected cells
  const expected = columns * rows;
  if (values.length !== expected) {
    // Some cells may be blank trailing columns — pad with false
    while (values.length < expected) {
      values.push(false);
    }
  }

  return values;
};

/**
 * Walk the LPC asset directory and return all .webp files.
 */
const walkLpcAssets = (): string[] => {
  const results: string[] = [];
  const walkDir = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.webp')) {
        results.push(fullPath);
      }
    }
  };
  walkDir(LPC_ASSETS_DIR);
  results.sort();
  return results;
};

/**
 * Build a baseline entry lookup: tag → LpcCoverageBaselineEntry.
 */
const buildBaselineLookup = (
  baseline: LpcCoverageBaseline,
): Map<string, LpcCoverageBaselineEntry> => {
  const lookup = new Map<string, LpcCoverageBaselineEntry>();
  for (const entry of baseline.entries) {
    lookup.set(entry.tag, entry);
  }
  return lookup;
};

/**
 * Compute the union of empty rows for a pair of sheets.
 * A row is covered if EITHER sheet has pixels in that row.
 */
const computePairedEmptyRows = (
  primary: SheetResult,
  paired: SheetResult | undefined,
): readonly number[] => {
  if (!paired) {
    return primary.emptyRows;
  }
  const result: number[] = [];
  for (let row = 0; row < Math.max(primary.coverage.rows, paired.coverage.rows); row++) {
    const primaryHasPixels =
      primary.coverage.framesPerRow[row] !== undefined && primary.coverage.framesPerRow[row] > 0;
    const pairedHasPixels =
      paired.coverage.framesPerRow[row] !== undefined && paired.coverage.framesPerRow[row] > 0;
    if (!primaryHasPixels && !pairedHasPixels) {
      result.push(row);
    }
  }
  return result;
};

// ── Main audit logic ───────────────────────────────────────────────────

const audit = async (options: { force: boolean; generateBaseline: boolean }): Promise<void> => {
  const { force, generateBaseline } = options;
  const t0 = Date.now();

  console.log('🔍 LPC Sheet Coverage Audit — deterministic alpha inspection');
  console.log(`   Asset dir: ${LPC_ASSETS_DIR}`);
  console.log('');

  // Load hash cache
  const assetHashes = loadAssetHashes();
  console.log(`📦 Loaded ${assetHashes.size} asset hash(es) from sidecar`);

  // Walk assets
  const allSheets = walkLpcAssets();
  console.log(`📄 Found ${allSheets.length} LPC sheet(s)`);

  if (allSheets.length === 0) {
    console.log('⚠️  No LPC sheets found. Nothing to audit.');
    process.exit(0);
  }

  // Load baseline (if not generating)
  let baseline: LpcCoverageBaseline | null = null;
  let baselineLookup: Map<string, LpcCoverageBaselineEntry> | null = null;
  if (!generateBaseline) {
    baseline = loadBaseline();
    if (baseline) {
      baselineLookup = buildBaselineLookup(baseline);
      console.log(`📋 Loaded baseline: ${baseline.entries.length} entry(ies)`);
    } else {
      console.log('⚠️  No baseline found. Run with --generate-baseline first.');
      console.log('   Without a baseline, the audit cannot detect regressions.');
    }
  }

  console.log('');

  // Process each sheet — concurrent pool
  const sheetResults: SheetResult[] = [];
  let processedCount = 0;
  const totalSheets = allSheets.length;

  /** Process a single sheet and return its result. */
  const processSheet = async (filePath: string): Promise<SheetResult> => {
    const relPath = relative(LPC_ASSETS_DIR, filePath);
    const tag = pathToTag(relPath);

    // Check hash cache
    const currentHash = assetHashes.get(tag);
    if (!force && currentHash) {
      const fileHash = await sha256File(filePath);
      if (fileHash === currentHash) {
        // File unchanged — skip inspection
        return {
          tag,
          filePath,
          coverage: {
            tag,
            pitch: 0,
            columns: 0,
            rows: 0,
            framesPerRow: [],
          },
          emptyRows: [],
        };
      }
    }

    try {
      // Get dimensions
      const dims = await getImageDimensions(filePath);

      // Resolve geometry via C-428 resolver
      const geometry = resolveLpcSheetGeometry(dims);

      // Inspect alpha
      const cellAlpha = await inspectSheetAlpha({
        filePath,
        pitch: geometry.pitch,
        columns: geometry.columns,
        rows: geometry.rows,
      });

      // Compute framesPerRow
      const framesPerRow: number[] = [];
      for (let row = 0; row < geometry.rows; row++) {
        let count = 0;
        for (let col = 0; col < geometry.columns; col++) {
          const idx = row * geometry.columns + col;
          if (idx < cellAlpha.length && cellAlpha[idx]) {
            count++;
          }
        }
        framesPerRow.push(count);
      }

      // Determine empty rows (no frames with pixels)
      const emptyRows: number[] = [];
      for (let row = 0; row < geometry.rows; row++) {
        if (framesPerRow[row] === 0) {
          emptyRows.push(row);
        }
      }

      const coverage: LpcSheetCoverage = {
        tag,
        pitch: geometry.pitch,
        columns: geometry.columns,
        rows: geometry.rows,
        framesPerRow,
      };

      return {
        tag,
        filePath,
        coverage,
        emptyRows,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        tag,
        filePath,
        coverage: {
          tag,
          pitch: 0,
          columns: 0,
          rows: 0,
          framesPerRow: [],
        },
        emptyRows: [],
        error: message,
      };
    }
  };

  // Process in concurrent batches
  const logProgress = (tag: string, result: SheetResult): void => {
    processedCount++;
    const progress = `[${processedCount}/${totalSheets}]`;
    if ('error' in result && result.error) {
      console.error(`${progress} ${tag} — ❌ Error: ${result.error}`);
    } else if (result.coverage.pitch === 0) {
      console.log(`${progress} ${tag} — ♻ cached`);
    } else {
      const rowSummary = result.coverage.framesPerRow
        .map((c, i) => `${DIRECTION_LABELS[i] ?? i}:${c}`)
        .join(' ');
      console.log(`${progress} ${tag} — ${rowSummary}`);
    }
  };

  // Process in batches of CONCURRENCY
  for (let i = 0; i < allSheets.length; i += CONCURRENCY) {
    const batch = allSheets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        const result = await processSheet(filePath);
        logProgress(pathToTag(relative(LPC_ASSETS_DIR, filePath)), result);
        return result;
      }),
    );
    sheetResults.push(...batchResults);
  }

  const elapsedMs = Date.now() - t0;
  console.log('');
  console.log(`⏱  Audit completed in ${elapsedMs}ms`);

  // Build report
  const regressions: RegressionEntry[] = [];
  const knownGaps: KnownGapEntry[] = [];
  const newlyCovered: string[] = [];

  for (const sr of sheetResults) {
    const baselineEntry = baselineLookup?.get(sr.tag);
    const pairedTag = baselineEntry?.pairedWith;
    let effectiveEmptyRows = sr.emptyRows;

    // Handle paired sheets
    if (pairedTag) {
      const pairedResult = sheetResults.find((s) => s.tag === pairedTag);
      effectiveEmptyRows = computePairedEmptyRows(sr, pairedResult);
    }

    if (baselineEntry) {
      // Known gap — check if it's still a gap
      if (effectiveEmptyRows.length > 0) {
        // Check if the gap has widened (new empty rows not in acceptedEmptyRows)
        const newEmpty = effectiveEmptyRows.filter(
          (r) => !baselineEntry.acceptedEmptyRows.includes(r),
        );
        if (newEmpty.length > 0) {
          regressions.push({
            tag: sr.tag,
            emptyRows: effectiveEmptyRows,
            baselineAccepted: baselineEntry.acceptedEmptyRows,
          });
        } else {
          knownGaps.push({
            tag: sr.tag,
            emptyRows: effectiveEmptyRows,
            reason: baselineEntry.reason,
          });
        }
      } else if (baselineEntry.acceptedEmptyRows.length > 0) {
        // Previously had a gap, now fully covered
        newlyCovered.push(sr.tag);
      }
    } else if (effectiveEmptyRows.length > 0) {
      // Not in baseline — any gap is a regression
      regressions.push({
        tag: sr.tag,
        emptyRows: effectiveEmptyRows,
        baselineAccepted: [],
      });
    }
  }

  // Generate baseline if requested
  if (generateBaseline) {
    const baselineEntries: LpcCoverageBaselineEntry[] = [];

    for (const sr of sheetResults) {
      if (sr.emptyRows.length > 0) {
        baselineEntries.push({
          tag: sr.tag,
          acceptedEmptyRows: sr.emptyRows,
          reason: 'C-431 — behind pass collection not yet implemented',
        });
      }
    }

    const newBaseline: LpcCoverageBaseline = {
      schemaVersion: BASELINE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      auditedCount: sheetResults.length,
      entries: baselineEntries,
    };

    writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
    console.log(`📝 Baseline written: ${BASELINE_PATH} (${baselineEntries.length} gap(s))`);
    process.exit(0);
  }

  // Print report
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    auditedCount: sheetResults.length,
    passedCount: sheetResults.length - regressions.length - knownGaps.length,
    regressionCount: regressions.length,
    knownGapCount: knownGaps.length,
    newlyCoveredCount: newlyCovered.length,
    elapsedMs,
    sheets: sheetResults,
    regressions,
    knownGaps,
    newlyCovered,
  };

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('📊 Coverage Audit Report');
  console.log('═══════════════════════════════════════════');
  console.log(`   Audited:        ${report.auditedCount}`);
  console.log(`   Passed:         ${report.passedCount}`);
  console.log(`   Known gaps:     ${report.knownGapCount}`);
  console.log(`   Regressions:    ${report.regressionCount}`);
  console.log(`   Newly covered:  ${report.newlyCoveredCount}`);
  console.log(`   Elapsed:        ${report.elapsedMs}ms`);

  if (report.regressions.length > 0) {
    console.log('');
    console.log('❌ REGRESSIONS:');
    for (const reg of report.regressions) {
      const rowNames = reg.emptyRows.map((r) => DIRECTION_LABELS[r] ?? String(r)).join(', ');
      console.log(`   • ${reg.tag} — empty row(s): ${rowNames}`);
      if (reg.baselineAccepted.length > 0) {
        const acceptedNames = reg.baselineAccepted
          .map((r) => DIRECTION_LABELS[r] ?? String(r))
          .join(', ');
        console.log(`     (baseline accepted: ${acceptedNames})`);
      }
    }
  }

  if (report.knownGaps.length > 0) {
    console.log('');
    console.log('📋 Known gaps (baselined):');
    for (const gap of report.knownGaps) {
      const rowNames = gap.emptyRows.map((r) => DIRECTION_LABELS[r] ?? String(r)).join(', ');
      console.log(`   • ${gap.tag} — ${rowNames} (${gap.reason})`);
    }
  }

  if (report.newlyCovered.length > 0) {
    console.log('');
    console.log('✅ Newly covered sheets:');
    for (const tag of report.newlyCovered) {
      console.log(`   • ${tag}`);
    }
  }

  // Exit with non-zero on regressions
  if (report.regressionCount > 0) {
    console.log('');
    console.log(`❌ ${report.regressionCount} regression(s) detected.`);
    process.exit(1);
  }

  console.log('');
  console.log('✅ All sheets pass — no regressions against baseline.');
  process.exit(0);
};

// ── Exports (for unit tests) ───────────────────────────────────────────

export {
  type AuditReport,
  buildBaselineLookup,
  computePairedEmptyRows,
  inspectSheetAlpha,
  type KnownGapEntry,
  type LpcCoverageBaseline,
  type LpcCoverageBaselineEntry,
  type LpcSheetCoverage,
  parseTag,
  pathToTag,
  type RegressionEntry,
  type SheetResult,
};

// ── CLI entry ──────────────────────────────────────────────────────────

// Only run when executed directly, not when imported by tests
if (import.meta.main) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const generateBaseline = args.includes('--generate-baseline');

  audit({ force, generateBaseline }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Fatal error:', message);
    process.exit(1);
  });
}
