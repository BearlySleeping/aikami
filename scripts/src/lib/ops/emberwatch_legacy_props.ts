// scripts/src/lib/ops/emberwatch_legacy_props.ts
//
// The six remaining legacy grid-atlas furniture frames — crate, table, bed,
// counter, bookshelf, anvil — are known, deliberate debt. No accepted
// standalone source exists for them yet, so every prop placed with one of these
// frames still renders from the legacy 32px grid atlas.
//
// This tool turns that debt into an actionable, machine-readable replacement
// manifest: for each missing frame it names the target replacement frame, the
// prop ids and maps that depend on it, the matching asset-brief generation job
// (prompt + target canvas + acceptance gates), and the acceptance criteria a
// replacement must satisfy before it can be wired in.
//
// It does NOT generate art. Generation is a separate, human-gated operation
// (`generate:batch` → `emberwatch:accept`); this manifest is the input for it.
//
// Run: bun scripts/src/lib/ops/emberwatch_legacy_props.ts [--check] [--json]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_GRID_PROP_FRAMES } from './emberwatch_prop_source_guard.ts';
import { buildVisualReport } from './emberwatch_visual_report.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const MANIFEST_PATH = join(repository, 'docs/plans/emberwatch_legacy_prop_replacements.json');
const BRIEF_PATH = join(repository, 'docs/plans/emberwatch_asset_brief.json');

type BriefJob = {
  id?: string;
  subject?: string;
  targetCanvas?: [number, number];
  preparationProfile?: string;
  status?: string;
  binding?: { targetIds?: string[] };
};

export type LegacyPropReplacement = {
  frame: string;
  replacementFrame: string;
  briefJobId: string | null;
  targetCanvas: [number, number] | null;
  preparationProfile: string | null;
  propIds: string[];
  maps: string[];
  acceptance: string[];
};

export type LegacyPropManifest = {
  schemaVersion: 1;
  kind: 'emberwatch-legacy-prop-replacements';
  generatedBy: 'scripts/src/lib/ops/emberwatch_legacy_props.ts';
  policy: string;
  counts: { legacyFrames: number; replacementFrames: number; placedProps: number };
  items: LegacyPropReplacement[];
};

const ACCEPTANCE = [
  'standalone PNG or WebP with native alpha under content/packs/emberwatch/props/',
  'manifest prop table declares renderSize, anchor (0.5, 1) and an explicit shadow',
  'collision footprint authored separately from the render size (never inferred from alpha)',
  'regenerated prop atlas packs the frame without a grid-atlas name collision',
  'prop source guard classifies every affected prop id as accepted',
];

const briefJobs = (): Map<string, BriefJob> => {
  if (!existsSync(BRIEF_PATH)) {
    return new Map();
  }
  const brief = JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as { jobs?: BriefJob[] };
  return new Map((brief.jobs ?? []).map((job) => [String(job.id), job]));
};

const replacementFor = (frame: string): string => {
  const stem = frame.replace(/\.[^.]+$/, '');
  return `prop_${stem}.png`;
};

/** Builds the replacement manifest from the current pack + asset brief. */
export const buildLegacyPropManifest = (): LegacyPropManifest => {
  const report = buildVisualReport();
  const jobs = briefJobs();
  const items: LegacyPropReplacement[] = [];
  let placedProps = 0;

  for (const frame of [...LEGACY_GRID_PROP_FRAMES].sort()) {
    const rows = report.props.filter((row) => row.frame === frame);
    const propIds = [...new Set(rows.map((row) => row.propId))].sort();
    const maps = [...new Set(rows.map((row) => row.map))].sort();
    placedProps += rows.length;
    const briefJob =
      [...jobs.values()].find((job) =>
        (job.binding?.targetIds ?? []).some((id) => propIds.includes(id)),
      ) ?? jobs.get(frame.replace(/\.[^.]+$/, ''));
    items.push({
      frame,
      replacementFrame: replacementFor(frame),
      briefJobId: briefJob?.id ?? null,
      targetCanvas: briefJob?.targetCanvas ?? null,
      preparationProfile: briefJob?.preparationProfile ?? null,
      propIds,
      maps,
      acceptance: ACCEPTANCE,
    });
  }

  return {
    schemaVersion: 1,
    kind: 'emberwatch-legacy-prop-replacements',
    generatedBy: 'scripts/src/lib/ops/emberwatch_legacy_props.ts',
    policy:
      'Every frame here renders from the legacy grid atlas because no accepted standalone source exists. Replace by generating the named replacementFrame through the asset brief job, accepting it (emberwatch:accept), updating the prop table frame, regenerating the props atlas, and re-running emberwatch:validate + emberwatch:audit. The target is zero legacy-grid prop dependencies.',
    counts: { legacyFrames: items.length, replacementFrames: items.length, placedProps },
    items,
  };
};

const normalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, normalizeJsonValue(entry)]),
  );
};

const normalizeManifest = (manifest: LegacyPropManifest): unknown =>
  normalizeJsonValue({
    ...manifest,
    items: manifest.items
      .map((item) => ({
        ...item,
        propIds: [...item.propIds].sort(),
        maps: [...item.maps].sort(),
      }))
      .sort((a, b) => a.frame.localeCompare(b.frame)),
  });

/**
 * Pure comparison of a declared manifest against a freshly generated one.
 * Normalizes key/array order and compares the COMPLETE document — ids,
 * propIds, maps, frames, target canvas, preparation profile and acceptance
 * criteria — so a stale acceptance string or target canvas fails `--check`.
 */
export const compareLegacyPropManifests = (
  declared: LegacyPropManifest,
  wanted: LegacyPropManifest,
): string[] => {
  const reasons: string[] = [];
  const declaredFrames = declared.items.map((item) => item.frame).sort();
  const wantedFrames = wanted.items.map((item) => item.frame).sort();
  if (declaredFrames.join(',') !== wantedFrames.join(',')) {
    reasons.push(
      `manifest frames [${declaredFrames.join(', ')}] do not match the legacy allowlist [${wantedFrames.join(', ')}]`,
    );
  }
  if (JSON.stringify(normalizeManifest(declared)) !== JSON.stringify(normalizeManifest(wanted))) {
    reasons.push('manifest contents do not match the current generated replacement manifest');
  }
  for (const item of declared.items) {
    if (item.briefJobId === null) {
      reasons.push(`frame ${item.frame} has no asset-brief generation job`);
    }
  }
  if (declared.items.length !== LEGACY_GRID_PROP_FRAMES.size) {
    reasons.push(
      `manifest covers ${declared.items.length} frames but the allowlist has ${LEGACY_GRID_PROP_FRAMES.size}`,
    );
  }
  return reasons;
};

/** Validates the committed manifest still covers exactly the legacy frames. */
export const checkLegacyPropManifest = (): { ok: boolean; reasons: string[] } => {
  if (!existsSync(MANIFEST_PATH)) {
    return { ok: false, reasons: [`missing ${MANIFEST_PATH}`] };
  }
  const declared = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as LegacyPropManifest;
  const reasons = compareLegacyPropManifests(declared, buildLegacyPropManifest());
  return { ok: reasons.length === 0, reasons };
};

const main = (): void => {
  const build = buildLegacyPropManifest();
  if (process.argv.includes('--check')) {
    const result = checkLegacyPropManifest();
    if (result.ok) {
      console.log(`✅ legacy prop replacement manifest is current (${build.items.length} frames)`);
      return;
    }
    console.error('❌ legacy prop replacement manifest is stale:');
    for (const reason of result.reasons) {
      console.error(`   ${reason}`);
    }
    process.exit(1);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(build, null, 2));
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(build, null, 2)}\n`);
  console.log(
    `Wrote ${MANIFEST_PATH} — ${build.counts.legacyFrames} legacy frames across ${build.counts.placedProps} placed props`,
  );
};

if (import.meta.main) {
  main();
}
