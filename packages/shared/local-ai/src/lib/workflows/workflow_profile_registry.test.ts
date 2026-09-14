// packages/shared/local-ai/src/lib/workflows/workflow_profile_registry.test.ts
//
// C-520 AC-2: no false LoRA capability. A model-family/LoRA combination the
// repository graph cannot honour fails before HTTP submission, and an
// experimental profile is never dispatchable.
//
// Contract: C-520 Versioned image workflows and asset preparation
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { WORKFLOW_PROFILE_IDS, WORKFLOW_VALIDATION_CODES } from '@aikami/constants';
import { WorkflowValidationError } from './workflow_compiler.ts';
import {
  assertWorkflowRegistryIntegrity,
  describeWorkflowProfileReadiness,
  getWorkflowProfile,
  listWorkflowTemplates,
  registerWorkflowProfile,
  requireWorkflowProfile,
  resetWorkflowRegistriesForTests,
  resolveWorkflowProfileForRequest,
  verifyWorkflowRegistryIntegrity,
} from './workflow_profile_registry.ts';
import profileData from './workflow_profiles.json' with { type: 'json' };
import templateData from './workflow_templates.json' with { type: 'json' };

/** Runs `fn`, returning the thrown WorkflowValidationError. */
const capture = (fn: () => unknown): WorkflowValidationError => {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(WorkflowValidationError);
  return thrown as WorkflowValidationError;
};

const registerLoraCapableFixture = (): void => {
  const base = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.flux2Klein4b);
  registerWorkflowProfile({
    ...base,
    id: 'lora-capable-fixture',
    capabilities: { ...base.capabilities, lora: true },
    allowedLoras: [{ path: 'approved-4b-style.safetensors', modelFamily: 'flux2-klein' }],
  });
};

beforeEach(resetWorkflowRegistriesForTests);
afterEach(resetWorkflowRegistriesForTests);

describe('C-520 AC-2: LoRA capability is declared, not assumed', () => {
  test('the shipped legacy profile declares no LoRA support', () => {
    const profile = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.sdxlLegacy);
    expect(profile.capabilities.lora).toBe(false);
    expect(profile.allowedLoras).toEqual([]);
  });

  test('a LoRA request against the legacy profile fails before submission', () => {
    const error = capture(() =>
      resolveWorkflowProfileForRequest({ loras: ['gmsspritesheet1.safetensors'] }),
    );
    expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.unsupportedCapability);
    expect(error.message).toContain('does not support LoRA');
  });

  test('a LoRA outside the allowlist fails for a profile that does support LoRA', () => {
    registerLoraCapableFixture();

    const error = capture(() =>
      resolveWorkflowProfileForRequest({
        profileId: 'lora-capable-fixture',
        loras: ['some_other_lora.safetensors'],
      }),
    );
    expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.unsupportedLora);
    expect(error.message).toContain('approved-4b-style.safetensors');
  });

  test('a LoRA inside the allowlist of the right family resolves', () => {
    registerLoraCapableFixture();
    const resolved = resolveWorkflowProfileForRequest({
      profileId: 'lora-capable-fixture',
      loras: ['approved-4b-style.safetensors'],
    });
    expect(resolved.profile.id).toBe('lora-capable-fixture');
  });

  test('a 9B spritesheet LoRA can never be attached to the 4B base', () => {
    const error = capture(() =>
      resolveWorkflowProfileForRequest({
        profileId: WORKFLOW_PROFILE_IDS.flux2Klein4b,
        loras: ['gmsspritesheet1.safetensors'],
      }),
    );
    expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.unsupportedCapability);
    expect(error.message).toContain('flux2-klein');
  });

  test('registering a profile whose allowlist names another family is refused at load', () => {
    const base = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.flux2Klein4b);
    expect(() =>
      registerWorkflowProfile({
        ...base,
        id: 'family-mismatch-fixture',
        allowedLoras: [
          { path: 'gmsspritesheet1.safetensors', modelFamily: 'mystic07-spritesheet-9b' },
        ],
        capabilities: { ...base.capabilities, lora: true },
      }),
    ).toThrow(/attaching a LoRA to the wrong base weights is refused at load/);
  });

  test('a profile claiming the lora capability with no allowlist is refused at load', () => {
    const base = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.flux2Klein4b);
    expect(() =>
      registerWorkflowProfile({
        ...base,
        id: 'empty-allowlist-fixture',
        capabilities: { ...base.capabilities, lora: true },
        allowedLoras: [],
      }),
    ).toThrow(/declares the lora capability but allows no LoRA/);
  });
});

describe('C-520 AC-2: capability UI matches the selected profile', () => {
  test('the legacy profile refuses a reference-image request', () => {
    const error = capture(() =>
      resolveWorkflowProfileForRequest({ capabilities: { referenceImages: true } }),
    );
    expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.unsupportedCapability);
    expect(error.message).toContain('referenceImages');
  });

  test('the FLUX profile accepts a reference-image request', () => {
    const resolved = resolveWorkflowProfileForRequest({
      profileId: WORKFLOW_PROFILE_IDS.flux2Klein4b,
      capabilities: { referenceImages: true, initImage: true },
    });
    expect(resolved.profile.capabilities.referenceImages).toBe(true);
    expect(resolved.template.id).toBe('flux2-klein-4b-comfyui-v1');
  });

  test('a mask request is refused by every shipped profile', () => {
    for (const profileId of [WORKFLOW_PROFILE_IDS.sdxlLegacy, WORKFLOW_PROFILE_IDS.flux2Klein4b]) {
      const error = capture(() =>
        resolveWorkflowProfileForRequest({ profileId, capabilities: { mask: true } }),
      );
      expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.unsupportedCapability);
    }
  });

  test('an unknown profile id lists the known ones', () => {
    const error = capture(() => resolveWorkflowProfileForRequest({ profileId: 'nope' }));
    expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.profileNotDispatchable);
    expect(error.message).toContain('sdxl-legacy');
  });
});

describe('C-520: the experimental lane is excluded, not hidden', () => {
  test('the Mystic07 profile is registered so its exclusion is auditable', () => {
    const profile = getWorkflowProfile(WORKFLOW_PROFILE_IDS.mystic07Spritesheet9b);
    expect(profile).toBeDefined();
    expect(profile?.status).toBe('experimental-blocked');
    expect(
      profile?.dependencies.some(
        (dependency) => dependency.filename === 'gmsspritesheet1.safetensors',
      ),
    ).toBe(true);
  });

  test('it can never be dispatched, even with a matching LoRA', () => {
    const error = capture(() =>
      resolveWorkflowProfileForRequest({
        profileId: WORKFLOW_PROFILE_IDS.mystic07Spritesheet9b,
        loras: ['gmsspritesheet1.safetensors'],
      }),
    );
    expect(error.code).toBe(WORKFLOW_VALIDATION_CODES.profileNotDispatchable);
    expect(error.message).toContain('experimental-blocked');
  });

  test('its blocked rights decision names the licence finding', () => {
    const profile = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.mystic07Spritesheet9b);
    expect(profile.rights.some((rights) => rights.decision === 'blocked')).toBe(true);
    expect(profile.rights[0]?.sourceUrls.length).toBeGreaterThan(0);
  });

  test('an experimental-blocked profile with no blocked rights entry is refused at load', () => {
    const base = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.mystic07Spritesheet9b);
    expect(() =>
      registerWorkflowProfile({
        ...base,
        id: 'unexplained-blocked-fixture',
        rights: base.rights.map((rights) => ({ ...rights, decision: 'pending' as const })),
      }),
    ).toThrow(/must name the eligibility or licence finding/);
  });

  test('only the blocked research profile ships with LoRA support', () => {
    const shippedWithLora = (
      profileData as readonly { id: string; capabilities: { lora: boolean } }[]
    )
      .filter((entry) => entry.capabilities.lora)
      .map((entry) => entry.id);
    expect(shippedWithLora).toEqual(['mystic07-spritesheet-9b']);
  });
});

describe('C-520: pinned profiles are integrity-checked', () => {
  test('every shipped profile pins a template hash that matches its template', async () => {
    expect(await verifyWorkflowRegistryIntegrity()).toEqual([]);
    await assertWorkflowRegistryIntegrity();
  });

  test('every shipped template is registered and addressable', () => {
    for (const entry of profileData as readonly { templateId: string }[]) {
      expect(listWorkflowTemplates().some((template) => template.id === entry.templateId)).toBe(
        true,
      );
    }
    expect(templateData.length).toBe(listWorkflowTemplates().length);
  });

  test('a profile naming an unknown template is refused at load', () => {
    const base = requireWorkflowProfile(WORKFLOW_PROFILE_IDS.sdxlLegacy);
    expect(() =>
      registerWorkflowProfile({ ...base, id: 'unknown-template-fixture', templateId: 'nope' }),
    ).toThrow(/names the unknown template/);
  });

  test('an invalid profile shape is refused at load', () => {
    expect(() => registerWorkflowProfile({ id: 'x' })).toThrow(/Invalid workflow profile/);
  });
});

describe('C-520: readiness names the unpinned artifacts', () => {
  test('the legacy profile pins no checkpoint hash, and says so instead of implying verification', () => {
    const issues = describeWorkflowProfileReadiness(requireWorkflowProfile('sdxl-legacy'));
    expect(issues.length).toBe(1);
    expect(issues[0]?.code).toBe(WORKFLOW_VALIDATION_CODES.missingDependency);
    expect(issues[0]?.message).toContain('sd_xl_base_1.0.safetensors');
    expect(issues[0]?.message).toContain('pins no SHA-256');
  });

  test('the opt-in FLUX profile names its three unpinned artifacts', () => {
    const issues = describeWorkflowProfileReadiness(
      requireWorkflowProfile(WORKFLOW_PROFILE_IDS.flux2Klein4b),
    );
    expect(issues.length).toBe(3);
    expect(issues.map((issue) => issue.message).join(' ')).toContain(
      'flux2-klein-base-4b.safetensors',
    );
    expect(
      issues.every((issue) => issue.code === WORKFLOW_VALIDATION_CODES.missingDependency),
    ).toBe(true);
  });

  test('the blocked research profile names four unpinned artifacts', () => {
    expect(
      describeWorkflowProfileReadiness(
        requireWorkflowProfile(WORKFLOW_PROFILE_IDS.mystic07Spritesheet9b),
      ).length,
    ).toBe(4);
  });
});

describe('C-520: a template edited without the profile is refused', () => {
  // Registered last: it deliberately drifts the registry, so every earlier
  // integrity assertion runs against the shipped data only.
  test('a drifted template hash is reported by name', async () => {
    registerWorkflowProfile({
      ...requireWorkflowProfile(WORKFLOW_PROFILE_IDS.sdxlLegacy),
      id: 'hash-drift-fixture',
      templateSha256: 'f'.repeat(64),
    });
    const issues = await verifyWorkflowRegistryIntegrity();
    expect(issues.some((issue) => issue.message.includes('hash-drift-fixture'))).toBe(true);
    await expect(assertWorkflowRegistryIntegrity()).rejects.toThrow(WorkflowValidationError);
  });
});
