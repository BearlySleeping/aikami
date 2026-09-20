// scripts/src/lib/ops/emberwatch_rights_audit.ts
//
// The real Emberwatch rights audit.
//
// Answers one question for every catalog tag the release would publish: may
// Aikami distribute THIS ARTIFACT? The answer comes from the corrected rights
// model — a generated asset is classified by its OUTPUT rights, corroborated
// against pinned evidence, never by its generator model's own licence.
//
// Emits a JSON digest so the candidate lock can pin the audit that justified a
// release, rather than asserting "rights were fine" in prose.
//
// Run: bun scripts/src/lib/ops/emberwatch_rights_audit.ts [--json]

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_RIGHTS_EVIDENCE,
  releaseConstraintsFor,
  rightsEvidenceDigest,
} from '../catalog/model_rights_evidence.ts';
import {
  type RightsGateCredit,
  runReleaseContentGate,
  runRightsGate,
} from '../catalog/rights_gate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');

/** Roots the catalog scans, in the order the publisher uses. */
const SCAN_ROOTS = [
  join(repository, 'apps/frontend/client/static/game-data'),
  join(repository, 'content/packs'),
] as const;

export type RightsAuditRoot = {
  root: string;
  entries: number;
  allowed: number;
  blocked: number;
  generated: number;
  projectOrUpstream: number;
  blockedTags: readonly string[];
};

export type RightsAuditResult = {
  ok: boolean;
  roots: readonly RightsAuditRoot[];
  totalEntries: number;
  totalBlocked: number;
  /** Digest of the pinned evidence the classification rests on. */
  evidenceDigest: string;
  /** Models whose art is published, with their revision and output rights. */
  models: readonly {
    modelId: string;
    revision: string;
    outputRights: string;
    evidenceUrl: string;
  }[];
  releaseContent: { ok: boolean; checkedCount: number; violations: readonly string[] };
  /** Stable digest of the whole audit, for the candidate lock. */
  digest: string;
};

/** Every file the release plane would carry, release-relative. */
const releasePaths = (): string[] => {
  const paths: string[] = [];
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root)) {
      continue;
    }
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        paths.push(relative(root, full));
      }
    };
    walk(root);
  }
  return paths;
};

export const runEmberwatchRightsAudit = (): RightsAuditResult => {
  const roots: RightsAuditRoot[] = [];
  const publishedModels = new Set<string>();

  for (const root of SCAN_ROOTS) {
    const manifestPath = join(root, 'manifest.json');
    const creditsPath = join(root, 'asset_credits.json');
    if (!existsSync(manifestPath) || !existsSync(creditsPath)) {
      roots.push({
        root: relative(repository, root),
        entries: 0,
        allowed: 0,
        blocked: 0,
        generated: 0,
        projectOrUpstream: 0,
        blockedTags: [],
      });
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      assets: Record<string, unknown>;
    };
    const credits = JSON.parse(readFileSync(creditsPath, 'utf8')) as {
      credits: Record<string, RightsGateCredit>;
    };

    const entries = Object.keys(manifest.assets).map((tag) => ({ tag }));
    const gate = runRightsGate({ entries, creditsByTag: credits.credits });

    let generated = 0;
    for (const tag of Object.keys(manifest.assets)) {
      const credit = credits.credits[tag];
      if (credit?.rights?.kind === 'generated') {
        generated += 1;
        const model = credit.rights.generator?.model;
        if (model) {
          publishedModels.add(model);
        }
      }
    }

    roots.push({
      root: relative(repository, root),
      entries: entries.length,
      allowed: gate.allowed.length,
      blocked: gate.blockedTags.length,
      generated,
      projectOrUpstream: entries.length - generated,
      blockedTags: gate.blockedTags,
    });
  }

  const constraints = releaseConstraintsFor([...publishedModels]);
  const content = runReleaseContentGate({ releasePaths: releasePaths(), constraints });

  const models = MODEL_RIGHTS_EVIDENCE.filter((record) => publishedModels.has(record.modelId)).map(
    (record) => ({
      modelId: record.modelId,
      revision: record.revision,
      outputRights: record.outputRights,
      evidenceUrl: record.evidence.url,
    }),
  );

  const totalBlocked = roots.reduce((sum, root) => sum + root.blocked, 0);
  const totalEntries = roots.reduce((sum, root) => sum + root.entries, 0);

  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        roots: roots.map((root) => ({
          root: root.root,
          entries: root.entries,
          blocked: root.blockedTags.slice().sort(),
        })),
        evidenceDigest: rightsEvidenceDigest(),
        releaseContent: content.violations.map((violation) => violation.path).sort(),
      }),
    )
    .digest('hex');

  return {
    ok: totalBlocked === 0 && content.ok,
    roots,
    totalEntries,
    totalBlocked,
    evidenceDigest: rightsEvidenceDigest(),
    models,
    releaseContent: {
      ok: content.ok,
      checkedCount: content.checkedCount,
      violations: content.violations.map(
        (violation) => `${violation.path} (${violation.constraintId})`,
      ),
    },
    digest,
  };
};

const main = (): void => {
  const result = runEmberwatchRightsAudit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('Emberwatch rights audit — may Aikami distribute each artifact?');
  console.log('');
  for (const root of result.roots) {
    console.log(
      `  ${root.root}: ${root.entries} entries — ${root.allowed} allowed, ${root.blocked} blocked ` +
        `(${root.generated} generated, ${root.projectOrUpstream} project/upstream)`,
    );
    for (const tag of root.blockedTags.slice(0, 5)) {
      console.log(`      BLOCKED ${tag}`);
    }
  }
  console.log('');
  for (const model of result.models) {
    console.log(
      `  model ${model.modelId}@${model.revision.slice(0, 12)} — outputs: ${model.outputRights}`,
    );
    console.log(`      evidence: ${model.evidenceUrl}`);
  }
  console.log('');
  console.log(
    `  release content: ${result.releaseContent.checkedCount} path(s) checked, ` +
      `${result.releaseContent.violations.length} violation(s)`,
  );
  for (const violation of result.releaseContent.violations) {
    console.log(`      VIOLATION ${violation}`);
  }
  console.log('');
  console.log(`  audit digest: ${result.digest}`);
  console.log(
    result.ok
      ? `✅ rights audit passed — ${result.totalEntries} artifact(s), 0 blocked`
      : `❌ rights audit FAILED — ${result.totalBlocked} blocked artifact(s)`,
  );
  if (!result.ok) {
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}
