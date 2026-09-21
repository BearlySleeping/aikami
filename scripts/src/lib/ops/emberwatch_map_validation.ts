// scripts/src/lib/ops/emberwatch_map_validation.ts
//
// Automatic map validation for the Emberwatch authoring workflow.
//
// Pure read-only analysis over the committed maps + manifest, designed as the
// first gate in `bun run emberwatch:studio` and as a repair guide for an
// autonomous polish agent. It computes navigation connectivity rather than
// trusting visual inspection, and never infers collision from PNG alpha.
//
// The rule set is documented in `emberwatch_map_validation_rules.ts`; the
// indexed snapshot the rules read is built in `emberwatch_map_validation_context.ts`.
//
// Run: bun scripts/src/lib/ops/emberwatch_map_validation.ts [--json] [--out <path>]

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { missingCandidateOverrides } from './emberwatch_candidate_plane.ts';
import { checkLockedIdentities } from './emberwatch_locked_identity.ts';
import {
  buildContexts,
  type Manifest,
  type MapSummary,
  packRoot,
  readJson,
  repository,
  type ValidationFinding,
} from './emberwatch_map_validation_context.ts';
import {
  summarizeMap,
  validateConnectivity,
  validateNpcAndEvidence,
  validateProps,
  validateRouteWidth,
  validateStableIds,
  validateTransitions,
} from './emberwatch_map_validation_rules.ts';
import { readAcceptedPropSources } from './emberwatch_prop_source_guard.ts';

export type {
  MapSummary,
  ValidationFinding,
  ValidationSeverity,
} from './emberwatch_map_validation_context.ts';
export { COMPANION_SAFE_ROUTE_WIDTH } from './emberwatch_map_validation_rules.ts';

export type EmberwatchMapValidation = {
  schemaVersion: 1;
  kind: 'emberwatch-map-validation';
  generatedAt: string;
  findings: ValidationFinding[];
  blockers: ValidationFinding[];
  maps: MapSummary[];
};

const DEFAULT_OUT = join(repository, 'docs/reference/emberwatch-map-validation.json');

const generatedAt = (): string =>
  process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString();

const finding = (
  rule: string,
  map: string,
  subject: string,
  detail: string,
): ValidationFinding => ({ rule, severity: 'error', map, subject, detail });

/** Runs every validation rule over the committed pack. Pure + read-only. */
export const validateEmberwatchMaps = (): EmberwatchMapValidation => {
  const manifest = readJson<Manifest>(join(packRoot, 'manifest.json'));
  const contexts = buildContexts(manifest);
  const acceptedSources = new Set(readAcceptedPropSources(repository));
  const findings: ValidationFinding[] = [];

  for (const context of contexts.values()) {
    validateProps({ context, manifest, acceptedSources, findings });
    validateStableIds(context, findings);
    validateNpcAndEvidence({ context, manifest, findings });
    validateConnectivity({ context, manifest, findings });
    validateRouteWidth(context, findings);
  }
  validateTransitions(contexts, findings);

  const missingPlane = missingCandidateOverrides(repository);
  if (missingPlane.length > 0) {
    findings.push(
      finding(
        'candidate-plane-incomplete',
        '*',
        'candidate-plane',
        `local candidate origin would serve stale rows for: ${missingPlane.join(', ')}`,
      ),
    );
  }

  // A visual-polish edit must never silently move a save/quest/transition
  // reference. The golden is the deliberate-change gate; see
  // `emberwatch_locked_identity.ts`.
  const identities = checkLockedIdentities();
  if (!identities.ok) {
    for (const drift of identities.drift) {
      findings.push(
        finding(
          'locked-identity-drift',
          '*',
          drift.path,
          [
            drift.removed.length > 0 ? `removed: ${drift.removed.join(', ')}` : '',
            drift.added.length > 0 ? `added: ${drift.added.join(', ')}` : '',
          ]
            .filter((part) => part.length > 0)
            .join('; ') || 'locked identities differ from the golden',
        ),
      );
    }
  }

  return {
    schemaVersion: 1,
    kind: 'emberwatch-map-validation',
    generatedAt: generatedAt(),
    findings,
    blockers: findings.filter((entry) => entry.severity === 'error'),
    maps: [...contexts.values()].map((context) => summarizeMap(context, manifest)),
  };
};

const report = (validation: EmberwatchMapValidation): void => {
  console.log(`Emberwatch map validation — ${validation.maps.length} maps`);
  for (const summary of validation.maps) {
    console.log(
      `  ${summary.id.padEnd(14)} ${summary.width}×${summary.height}  npc ${summary.npcCount}  prop ${summary.propCount}  ` +
        `transitions ${summary.transitionCount}  walkable ${summary.walkablePercent}%  legacy ${summary.legacyFrames.length}`,
    );
  }
  for (const entry of validation.findings) {
    console.log(
      `  ${entry.severity === 'error' ? 'ERROR  ' : 'warning'} [${entry.rule}] ${entry.map}/${entry.subject} — ${entry.detail}`,
    );
  }
  const warnings = validation.findings.length - validation.blockers.length;
  console.log(
    validation.blockers.length === 0
      ? `✅ map validation passed — ${warnings} warning(s), 0 blocker(s)`
      : `❌ map validation FAILED — ${validation.blockers.length} blocker(s)`,
  );
};

const main = (): void => {
  const validation = validateEmberwatchMaps();
  const outFlag = process.argv.indexOf('--out');
  const outPath = outFlag >= 0 ? (process.argv[outFlag + 1] ?? DEFAULT_OUT) : DEFAULT_OUT;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(validation, null, 2));
  } else {
    report(validation);
  }
  if (existsSync(dirname(outPath))) {
    writeFileSync(outPath, `${JSON.stringify(validation, null, 2)}\n`);
  }
  process.exit(validation.blockers.length > 0 ? 1 : 0);
};

if (import.meta.main) {
  main();
}
