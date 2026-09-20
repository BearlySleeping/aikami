// scripts/src/lib/catalog/__tests__/rights_gate.test.ts
//
// The rights gate decides whether an ARTIFACT may be distributed. These tests
// pin the distinctions that an earlier revision conflated — above all that a
// generator model's own licence is not the output's licence.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MODEL_RIGHTS_EVIDENCE,
  type ModelRightsRecord,
  resolveModelRights,
  rightsEvidenceDigest,
} from '../model_rights_evidence.ts';
import {
  describeRightsGateFailure,
  loadAcknowledgedRightsTags,
  RESTRICTED_LICENSE_TERMS,
  runReleaseContentGate,
  runRightsGate,
} from '../rights_gate.ts';

const entries = (tags: string[]) => tags.map((tag) => ({ tag }));

const ANIMA = MODEL_RIGHTS_EVIDENCE[0];
if (!ANIMA) {
  throw new Error('the pinned evidence registry must contain the Anima record');
}
const ACE_STEP = MODEL_RIGHTS_EVIDENCE.find(
  (record) => record.modelId === 'audio-ace-step-v1-3.5b',
);
if (!ACE_STEP) {
  throw new Error('the pinned evidence registry must contain the ACE-Step record');
}

/** A generated-rights credit as the pipeline writes it. */
const generatedCredit = (overrides: {
  outputRights?: 'commercial-permitted' | 'non-commercial-only' | 'unknown';
  model?: string;
  revision?: string;
  modelUse?: string;
  modelRedistribution?: string;
}) => ({
  licenses: ['circlestone-labs-non-commercial-license'],
  rights: {
    kind: 'generated' as const,
    generator: {
      model: overrides.model ?? ANIMA.modelId,
      revision: overrides.revision ?? ANIMA.revision,
      engine: 'local-sd-cpp',
    },
    modelUse: overrides.modelUse ?? ANIMA.modelUse,
    modelRedistribution: overrides.modelRedistribution ?? ANIMA.modelRedistribution,
    outputRights: overrides.outputRights ?? ANIMA.outputRights,
    evidence: ANIMA.evidence,
    upstream: {
      id: ANIMA.upstream.id,
      licenseName: ANIMA.upstream.licenseName,
      outputRights: ANIMA.upstream.outputRights,
    },
  },
});

describe('the distinction the gate exists to make', () => {
  test('non-commercial model + explicitly commercially usable outputs => PASSES', () => {
    // The exact Anima situation. The model is non-commercial; the outputs are
    // not. Blocking on the model's terms would be a factual error about the
    // artifact being published.
    const result = runRightsGate({
      entries: entries(['emberwatch:props:prop_notice_board']),
      creditsByTag: { 'emberwatch:props:prop_notice_board': generatedCredit({}) },
    });
    expect(result.ok).toBe(true);
    expect(result.blockedTags).toEqual([]);
    expect(result.allowed[0]?.outputRights).toBe('commercial-permitted');
  });

  test('model redistribution restriction does NOT taint the output bytes', () => {
    // `modelRedistribution: 'restricted'` describes the WEIGHTS. The artifact
    // is a PNG that contains none of them.
    expect(ANIMA.modelRedistribution).toBe('restricted');
    const result = runRightsGate({
      entries: entries(['a', 'b']),
      creditsByTag: {
        a: generatedCredit({ modelRedistribution: 'restricted' }),
        b: generatedCredit({ modelRedistribution: 'permitted' }),
      },
    });
    expect(result.ok).toBe(true);
    expect(result.blockedTags).toEqual([]);
  });

  test('the generated Emberwatch score resolves through pinned ACE-Step rights', () => {
    const result = runRightsGate({
      entries: entries(['music:exploration:village_ward']),
      creditsByTag: {
        'music:exploration:village_ward': {
          licenses: ['Apache-2.0'],
          rights: {
            kind: 'generated',
            generator: {
              model: ACE_STEP.modelId,
              revision: ACE_STEP.revision,
              engine: 'ace-step',
            },
            modelUse: ACE_STEP.modelUse,
            modelRedistribution: ACE_STEP.modelRedistribution,
            outputRights: ACE_STEP.outputRights,
            evidence: ACE_STEP.evidence,
            upstream: {
              id: ACE_STEP.upstream.id,
              licenseName: ACE_STEP.upstream.licenseName,
              outputRights: ACE_STEP.upstream.outputRights,
            },
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.blockedTags).toEqual([]);
  });

  test('non-commercial model + UNKNOWN output terms => BLOCKS', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: generatedCredit({ outputRights: 'unknown' }) },
    });
    expect(result.ok).toBe(false);
    expect(result.blockedTags).toEqual(['t']);
  });

  test('model permitting outputs only NON-COMMERCIALLY => BLOCKS a commercial release', () => {
    // The mirror error: this must block even though the model may be USED.
    // Injected evidence, so the shipped registry is not polluted with a
    // fictional model just to exercise the branch.
    const ncModel: ModelRightsRecord = {
      ...ANIMA,
      modelId: 'test-nc-outputs-model',
      modelUse: 'commercial',
      outputRights: 'non-commercial-only',
    };
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: {
        t: generatedCredit({ model: 'test-nc-outputs-model', outputRights: 'non-commercial-only' }),
      },
      evidence: [ncModel],
    });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]?.outputRights).toBe('non-commercial-only');
    expect(result.blocks[0]?.reason).toContain('non-commercial-only');
  });

  test('a model whose output terms are UNKNOWN blocks even if the model is usable', () => {
    const unknownModel: ModelRightsRecord = {
      ...ANIMA,
      modelId: 'test-unknown-outputs-model',
      outputRights: 'unknown',
    };
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: {
        t: generatedCredit({ model: 'test-unknown-outputs-model', outputRights: 'unknown' }),
      },
      evidence: [unknownModel],
    });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]?.outputRights).toBe('unknown');
  });

  test('a credit claiming better output rights than the pinned evidence => BLOCKS', () => {
    // Self-declaration is not evidence.
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: {
        t: generatedCredit({ outputRights: 'commercial-permitted', revision: 'deadbeefdeadbeef' }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]?.reason).toContain('no pinned rights evidence');
  });

  test('a model revision the evidence does not vouch for => BLOCKS', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: {
        t: generatedCredit({ revision: '0000000000000000000000000000000000000000' }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]?.reason).toContain('no pinned rights evidence');
  });

  test('a credit whose outputRights disagree with the pinned evidence => BLOCKS', () => {
    // Registry says commercial-permitted; the credit understates it. Both
    // directions of disagreement are a data-integrity failure worth stopping on.
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: generatedCredit({ outputRights: 'non-commercial-only' }) },
    });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]?.reason).toContain('disagree');
  });
});

describe('upstream-licensed and project-owned assets', () => {
  test('locally authored / project-owned asset passes under project policy', () => {
    const result = runRightsGate({
      entries: entries(['emberwatch:maps:village']),
      creditsByTag: { 'emberwatch:maps:village': { licenses: ['MIT'] } },
    });
    expect(result.ok).toBe(true);
  });

  test('an explicitly incompatible asset licence blocks', () => {
    for (const licence of ['CC-BY-NC-4.0', 'research-only', 'no-redistribution']) {
      const result = runRightsGate({
        entries: entries(['t']),
        creditsByTag: { t: { licenses: [licence] } },
      });
      expect(result.ok).toBe(false);
    }
  });

  test('every declared restriction term is detected on an upstream licence', () => {
    for (const { term } of RESTRICTED_LICENSE_TERMS) {
      const result = runRightsGate({
        entries: entries(['t']),
        creditsByTag: { t: { licenses: [`vendor-${term}-license`] } },
      });
      expect(result.ok).toBe(false);
    }
  });

  test('an asset with no rights basis at all blocks', () => {
    const result = runRightsGate({ entries: entries(['t']), creditsByTag: {} });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]?.reason).toBe('no rights basis declared');
  });

  test('permissive upstream licences pass', () => {
    const result = runRightsGate({
      entries: entries(['a', 'b', 'c']),
      creditsByTag: {
        a: { licenses: ['OGA-BY 3.0'] },
        b: { licenses: ['CC-BY-SA 3.0'] },
        c: { licenses: ['GPL 3.0'] },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.checkedCount).toBe(3);
  });

  test('one blocked tag blocks the whole publish', () => {
    const result = runRightsGate({
      entries: entries(['ok', 'blocked']),
      creditsByTag: { ok: { licenses: ['MIT'] }, blocked: { licenses: ['research-only'] } },
    });
    expect(result.ok).toBe(false);
    expect(result.blockedTags).toEqual(['blocked']);
  });
});

describe('release-content gate — permitting the output does not permit the weights', () => {
  const constraints = ANIMA.releaseConstraints;

  test('the pinned Anima constraint forbids embedding the weights', () => {
    expect(constraints.length).toBeGreaterThan(0);
    expect(constraints[0]?.forbiddenContent).toContain('anima-aesthetic-v1.1.safetensors');
  });

  test('a release containing the model weights is refused', () => {
    const result = runReleaseContentGate({
      releasePaths: ['assets/abc123/anima-aesthetic-v1.1.safetensors', 'assets/def/prop.png'],
      constraints,
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.path).toContain('anima-aesthetic-v1.1.safetensors');
  });

  test('a release of generated art alone passes', () => {
    const result = runReleaseContentGate({
      releasePaths: ['assets/def/prop.png', 'assets/ghi/portrait.webp'],
      constraints,
    });
    expect(result.ok).toBe(true);
    expect(result.checkedCount).toBe(2);
  });
});

describe('evidence registry', () => {
  test('the Anima record pins the revision, not a moving branch', () => {
    expect(ANIMA.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(ANIMA.evidence.url).toContain(ANIMA.revision);
    expect(ANIMA.evidence.quote.length).toBeGreaterThan(20);
  });

  test('the upstream base model is recorded with its own output terms', () => {
    expect(ANIMA.upstream.id).toBe('nvidia/Cosmos-Predict2-2B-Text2Image');
    expect(ANIMA.upstream.licenseName).toBe('NVIDIA Open Model License');
    expect(ANIMA.upstream.outputRights).toBe('commercial-permitted');
  });

  test('resolveModelRights requires the pinned revision', () => {
    expect(resolveModelRights({ modelId: ANIMA.modelId, revision: ANIMA.revision })).toBeDefined();
    expect(resolveModelRights({ modelId: ANIMA.modelId })).toBeUndefined();
    expect(resolveModelRights({ modelId: ANIMA.modelId, revision: 'main' })).toBeUndefined();
    expect(
      resolveModelRights({ modelId: 'not-a-model', revision: ANIMA.revision }),
    ).toBeUndefined();
  });

  test('the evidence digest is stable and covers the output classification', () => {
    const digest = rightsEvidenceDigest();
    expect(digest).toBe(rightsEvidenceDigest());
    expect(digest).toContain('commercial-permitted');
    expect(digest).toContain(ANIMA.revision);
  });
});

describe('rights acknowledgements — a policy decision, not a flag', () => {
  test('an acknowledged tag is allowed through', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: { licenses: ['research-only'] } },
      acknowledgedTags: new Set(['t']),
    });
    expect(result.ok).toBe(true);
  });

  test('an acknowledgement only clears the tag it names', () => {
    const result = runRightsGate({
      entries: entries(['cleared', 'not-cleared']),
      creditsByTag: {
        cleared: { licenses: ['research-only'] },
        'not-cleared': { licenses: ['research-only'] },
      },
      acknowledgedTags: new Set(['cleared']),
    });
    expect(result.ok).toBe(false);
    expect(result.blockedTags).toEqual(['not-cleared']);
  });

  test('no acknowledgements file means nothing is acknowledged', () => {
    expect(loadAcknowledgedRightsTags(mkdtempSync(join(tmpdir(), 'rights-none-'))).size).toBe(0);
  });

  test('an acknowledgement without a recorded decision is ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rights-bare-'));
    writeFileSync(
      join(dir, 'rights_acknowledgements.json'),
      JSON.stringify({
        acknowledged: [{ tag: 'bare' }, { tag: 'decided', decision: 'legal reviewed' }],
      }),
    );
    const acknowledged = loadAcknowledgedRightsTags(dir);
    expect(acknowledged.has('bare')).toBe(false);
    expect(acknowledged.has('decided')).toBe(true);
  });

  test('a malformed acknowledgements file does not clear the gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rights-bad-'));
    writeFileSync(join(dir, 'rights_acknowledgements.json'), '{not json');
    expect(loadAcknowledgedRightsTags(dir).size).toBe(0);
  });
});

describe('describeRightsGateFailure', () => {
  test('names the tags and reasons and gives remediation', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: { licenses: ['research-only'] } },
    });
    const message = describeRightsGateFailure(result);
    expect(message).toContain('t');
    expect(message).toContain('research use only');
    expect(message).toContain('Remediation');
    // The remediation must not encourage conflating model and output terms.
    expect(message).toContain("model's own non-commercial terms are NOT automatically");
  });
});
