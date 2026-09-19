// scripts/src/lib/catalog/model_rights_evidence.ts
//
// Pinned rights evidence for models used by this repository's local generation
// pipeline.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// `rights_gate.ts` originally classified an asset by matching the licence
// STRING on its credit. For generated art that string was the GENERATOR
// MODEL's licence, so every Anima-produced asset was blocked as
// "non-commercial" — treating a restriction on the MODEL as a restriction on
// the OUTPUT. Those are different things, and conflating them is a factual
// error in both directions: it wrongly blocks assets whose outputs are
// explicitly commercially usable, and it would wrongly pass a model that does
// restrict its outputs.
//
// The distinction is not a matter of opinion here; it is written into the
// pinned licence text. So this module records what each licence actually says
// about the four separate questions:
//
//   1. may we USE the model?                 → modelUse
//   2. may we REDISTRIBUTE the model?        → modelRedistribution
//   3. may we USE/DISTRIBUTE its OUTPUTS?    → outputRights   ← the release question
//   4. what does the upstream base model say? → upstream
//
// The gate reads (3). (1) and (2) are recorded because they still bind the
// PIPELINE (we may not ship the weights), not the released art.
//
// ── Revision pinning ───────────────────────────────────────────────────────
//
// Evidence is keyed by (repo, revision). An upstream README is a mutable
// document: the licence can be revised, and a record read at revision A says
// nothing about revision B. `resolveModelRights` therefore returns `undefined`
// for an unpinned or mismatched revision, which the gate turns into a BLOCK —
// never into an assumption.
//
// Retrieved 2026-09-19. These are quotations from the pinned documents, not
// paraphrases, so a future reader can verify each classification.

/** May Aikami use and distribute the artifact this evidence covers? */
export type OutputRights = 'commercial-permitted' | 'non-commercial-only' | 'unknown';

/** May the model itself be used at all (training/inference)? */
export type ModelUseRights = 'non-commercial' | 'commercial' | 'unknown';

/** May the model weights be redistributed? */
export type ModelRedistributionRights = 'restricted' | 'permitted' | 'unknown';

/** A quotation from an immutable document revision. */
export type LicenseEvidence = {
  /** Human-readable document URL (the revision-specific "blob" form). */
  url: string;
  /** The revision the document was read AT — evidence is invalid for others. */
  revision: string;
  /** When it was retrieved (ISO date). */
  retrievedAt: string;
  /** Verbatim quotation supporting the classification. */
  quote: string;
};

/** The upstream base model a fine-tune derives from. */
export type UpstreamModelRights = {
  id: string;
  licenseName: string;
  licenseUrl: string;
  outputRights: OutputRights;
  evidence: LicenseEvidence;
};

/**
 * A restriction that binds the RELEASE ARTIFACT rather than the generated art.
 *
 * This is the case the original gate missed entirely: a licence can permit the
 * outputs while forbidding distribution of the weights. That is a real,
 * checkable release constraint — so it is recorded and checked, not assumed
 * away because the outputs are fine.
 */
export type ReleaseConstraint = {
  id: string;
  description: string;
  /** Verbatim clause that imposes it. */
  quote: string;
  /** Content that must NOT appear anywhere in a published release. */
  forbiddenContent: readonly string[];
};

export type ModelRightsRecord = {
  /** `models.manifest.json` entry id. */
  modelId: string;
  /** Upstream repo the evidence was read from. */
  repo: string;
  /** Pinned revision — evidence is only valid for THIS revision. */
  revision: string;
  licenseName: string;
  licenseUrl: string;
  modelUse: ModelUseRights;
  modelRedistribution: ModelRedistributionRights;
  /** THE RELEASE QUESTION: may the generated outputs be used/distributed? */
  outputRights: OutputRights;
  /** The evidence that establishes `outputRights`. */
  evidence: LicenseEvidence;
  /** Corroborating evidence, for the audit trail. */
  corroboratingEvidence: readonly LicenseEvidence[];
  upstream: UpstreamModelRights;
  releaseConstraints: readonly ReleaseConstraint[];
};

const RETRIEVED_AT = '2026-09-19';

const ANIMA_REVISION = 'f7382c4bf9d7ffe4ceea593a0adbb470c56dd79b';
const ANIMA_DOCS = `https://huggingface.co/circlestone-labs/Anima/blob/${ANIMA_REVISION}`;

/**
 * `image-anima-aesthetic-v1.1` — the model behind Emberwatch 5.0.0's generated
 * props, portraits and hostile-creature art.
 *
 * The headline fact, quoted from the model card at the pinned revision:
 *
 *   "Note that the non-commercial restriction applies only to the Model, and
 *    not to Outputs (the generated images). You may use generated images
 *    commercially."
 *
 * The licence text corroborates it twice, and the model card lists
 * "generating images to use as concept art or assets for a paid product (e.g.
 * video game or visual novel)" as ALLOWED commercial use.
 *
 * It equally lists as DISALLOWED: "embedding the model weights inside a
 * monetized game or other product". That is why `releaseConstraints` exists —
 * the outputs are clear, but the weights must never enter a release.
 */
const ANIMA_RIGHTS: ModelRightsRecord = {
  modelId: 'image-anima-aesthetic-v1.1',
  repo: 'circlestone-labs/Anima',
  revision: ANIMA_REVISION,
  licenseName: 'CircleStone Labs Non-Commercial License v1.2',
  licenseUrl: `${ANIMA_DOCS}/LICENSE.md`,
  modelUse: 'non-commercial',
  modelRedistribution: 'restricted',
  outputRights: 'commercial-permitted',
  evidence: {
    url: `${ANIMA_DOCS}/README.md`,
    revision: ANIMA_REVISION,
    retrievedAt: RETRIEVED_AT,
    quote:
      'Note that the non-commercial restriction applies only to the Model, and not to Outputs (the generated images). You may use generated images commercially.',
  },
  corroboratingEvidence: [
    {
      url: `${ANIMA_DOCS}/LICENSE.md`,
      revision: ANIMA_REVISION,
      retrievedAt: RETRIEVED_AT,
      quote:
        '“Derivative” means any (i) modified version of the CircleStone Model …, (ii) work based on the CircleStone Model …, or (iii) any other derivative work thereof. For the avoidance of doubt, Outputs are not considered Derivatives under this License.',
    },
    {
      url: `${ANIMA_DOCS}/LICENSE.md`,
      revision: ANIMA_REVISION,
      retrievedAt: RETRIEVED_AT,
      quote:
        'use, modify, copy, reproduce, create Derivatives of, or Distribute the CircleStone Model … (i) for any commercial or production purposes (with the exception that Outputs may be used commercially as per 2(d))',
    },
    {
      url: `${ANIMA_DOCS}/README.md`,
      revision: ANIMA_REVISION,
      retrievedAt: RETRIEVED_AT,
      quote:
        'Examples of allowed commercial use: … generating images to use as concept art or assets for a paid product (e.g. video game or visual novel)',
    },
  ],
  upstream: {
    id: 'nvidia/Cosmos-Predict2-2B-Text2Image',
    licenseName: 'NVIDIA Open Model License',
    licenseUrl:
      'https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license',
    outputRights: 'commercial-permitted',
    evidence: {
      url: 'https://huggingface.co/nvidia/Cosmos-Predict2-2B-Text2Image',
      revision: 'main',
      retrievedAt: RETRIEVED_AT,
      quote:
        'NVIDIA does not claim ownership to any outputs generated using the Models or Model Derivatives.',
    },
  },
  releaseConstraints: [
    {
      id: 'anima-no-weight-embedding',
      description:
        'The Anima weights must never be embedded in a distributed product. The outputs may ship; the model may not.',
      quote:
        'Examples of disallowed commercial use without a separate license: … embedding the model weights inside a monetized game or other product',
      forbiddenContent: ['anima-aesthetic-v1.1.safetensors', 'qwen_image_vae.safetensors'],
    },
  ],
};

/** Every model this repository generates publishable art with. */
export const MODEL_RIGHTS_EVIDENCE: readonly ModelRightsRecord[] = [ANIMA_RIGHTS];

/**
 * Resolves the rights record for a model at a PINNED revision.
 *
 * Returns `undefined` — which the gate treats as `unknown` and therefore
 * BLOCKS — when the model has no record, when no revision is supplied, or when
 * the revision differs from the one the evidence was read at. A record read at
 * one revision cannot vouch for another.
 */
export const resolveModelRights = (options: {
  modelId: string;
  revision?: string;
  /** Registry to search. Defaults to the committed one. */
  evidence?: readonly ModelRightsRecord[];
}): ModelRightsRecord | undefined => {
  const registry = options.evidence ?? MODEL_RIGHTS_EVIDENCE;
  const record = registry.find((candidate) => candidate.modelId === options.modelId);
  if (!record) {
    return undefined;
  }
  if (!options.revision || options.revision !== record.revision) {
    return undefined;
  }
  return record;
};

/** Every release constraint that applies to the given model ids. */
export const releaseConstraintsFor = (
  modelIds: readonly string[],
): readonly ReleaseConstraint[] => {
  const records = MODEL_RIGHTS_EVIDENCE.filter((record) => modelIds.includes(record.modelId));
  return records.flatMap((record) => record.releaseConstraints);
};

/** A stable digest of the evidence set, for the candidate lock. */
export const rightsEvidenceDigest = (): string => {
  const canonical = MODEL_RIGHTS_EVIDENCE.map((record) => ({
    modelId: record.modelId,
    revision: record.revision,
    outputRights: record.outputRights,
    evidenceUrl: record.evidence.url,
    upstream: { id: record.upstream.id, outputRights: record.upstream.outputRights },
  }));
  return JSON.stringify(canonical);
};
