// scripts/src/lib/ops/emberwatch_coverage_audit.ts
//
// Phase-1 coverage audit for the Emberwatch content pack.
//
// Produces a machine-readable inventory of every visual/audio surface the pack
// depends on and classifies each entry as accepted, acceptable-shared,
// placeholder-reuse, missing, needs-regeneration, needs-map-change or
// needs-runtime-capability. The report is the evidence base for the asset brief
// (docs/plans/emberwatch_asset_brief.json) and the release orchestrator's
// preflight.
//
// This script only READS. It never writes to the pack, the atlas build output
// or R2. `--out <path>` writes the report itself (default:
// docs/reference/emberwatch-coverage-audit.json).
//
// The rules live in `emberwatch_coverage_rules.ts`; this file is the CLI shell
// that indexes the pack, runs every rule, aggregates and reports.
//
// Run: bun scripts/src/lib/ops/emberwatch_coverage_audit.ts [--out <path>]
//
// Exit codes: 0 ok · 1 audit found blocking gaps (see report.blockers).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLASSIFICATIONS,
  type Classification,
  catalogTagsOf,
  collectCoverageInputs,
  type Finding,
  type PackManifest,
  repository,
  runCoverageRules,
} from './emberwatch_coverage_rules.ts';

type Report = {
  schemaVersion: 1;
  kind: 'emberwatch-coverage-audit';
  generatedBy: 'scripts/src/lib/ops/emberwatch_coverage_audit.ts';
  packId: string;
  packVersion: string;
  packUpdatedAt: string;
  generatedAt: string;
  summary: Record<Classification, number>;
  counts: Record<string, number>;
  findings: Finding[];
  blockers: Finding[];
};

const summarize = (findings: Finding[]): Record<Classification, number> => {
  const summary = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<Classification, number>;
  for (const finding of findings) {
    summary[finding.classification] += 1;
  }
  return summary;
};

/** A gap the pack must not ship with: missing, or standing in for something else. */
const blockersOf = (findings: Finding[]): Finding[] =>
  findings.filter(
    (finding) =>
      finding.classification === 'missing' ||
      finding.classification === 'placeholder/wrong-semantic-reuse',
  );

/** Deterministic when the caller pins it; otherwise the audit timestamp. */
const generatedAt = (): string =>
  process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString();

const outputPath = (): string => {
  const outFlag = process.argv.indexOf('--out');
  const explicit = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
  return explicit ?? join(repository, 'docs/reference/emberwatch-coverage-audit.json');
};

const buildReport = (
  findings: Finding[],
  manifest: PackManifest,
  counts: Record<string, number>,
): Report => ({
  schemaVersion: 1,
  kind: 'emberwatch-coverage-audit',
  generatedBy: 'scripts/src/lib/ops/emberwatch_coverage_audit.ts',
  packId: manifest.id,
  packVersion: manifest.version,
  packUpdatedAt: manifest.updatedAt,
  generatedAt: generatedAt(),
  summary: summarize(findings),
  counts: { ...counts, findings: findings.length },
  findings,
  blockers: blockersOf(findings),
});

const printSummary = (report: Report, outPath: string): void => {
  console.log(`Emberwatch coverage audit — pack ${report.packVersion}`);
  console.log(`  findings: ${report.findings.length}  blockers: ${report.blockers.length}`);
  for (const [classification, count] of Object.entries(report.summary)) {
    if (count > 0) {
      console.log(`    ${classification}: ${count}`);
    }
  }
  console.log(`  report: ${outPath}`);
  for (const blocker of report.blockers) {
    console.log(`  ⛔ [${blocker.classification}] ${blocker.id} — ${blocker.detail}`);
  }
};

const main = (): void => {
  const input = collectCoverageInputs();
  const findings = runCoverageRules(input);
  const report = buildReport(findings, input.manifest, {
    maps: Object.keys(input.manifest.maps).length,
    terrains: input.manifest.terrains.length,
    bakedTiles: input.bakedTiles,
    corner16Terrains: input.corner16Terrains,
    atlasCellsUsed: input.atlasCellsUsed,
    atlasCellsTotal: input.atlasCellsTotal,
    atlasCellsFree: input.atlasCellsTotal - input.atlasCellsUsed,
    props: Object.keys(input.manifest.props).length,
    npcs: Object.keys(input.manifest.npcs).length,
    hostileNpcs: input.hostileNpcIds.size,
    evidence: input.manifest.evidence.length,
    audioCues: input.manifest.audio.bindings.length,
    sourceImages: input.sourceImages.length,
    transitions: input.transitions.length,
    catalogTags: catalogTagsOf(input.manifest).length,
  });

  const outPath = outputPath();
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report, outPath);
  process.exit(report.blockers.length > 0 ? 1 : 0);
};

main();
