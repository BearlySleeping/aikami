// packages/shared/local-ai/src/lib/workflows/workflow_profile_registry.ts
//
// C-520: the versioned workflow-profile registry.
//
// Profiles are DATA (`workflow_profiles.json` + `workflow_templates.json`),
// validated at load time. Four things are enforced here rather than left to a
// hopeful graph build:
//
//   1. The profile's declared semantic inputs agree with its template's
//      markers — a declaration that does not reach the graph node it names is
//      a load error.
//   2. A LoRA the profile does not allow is refused. "The engine has a
//      LoraLoader node" is not a capability (AC-2).
//   3. An `experimental-blocked` profile is never dispatchable, so the
//      Mystic07 9B experiment cannot be reached by accident and cannot have
//      its weights mistaken for the 4B base.
//   4. A request that asks for a capability the profile does not prove fails
//      before any HTTP submission.
//
// The template SHA-256 check needs WebCrypto and is therefore split into
// {@link assertWorkflowRegistryIntegrity} — a host calls it once before the
// first submit, and the test suite calls it too.
//
// Contract: C-520 Versioned image workflows and asset preparation

import {
  DEFAULT_WORKFLOW_PROFILE_ID,
  WORKFLOW_VALIDATION_CODES,
  type WorkflowValidationCode,
} from '@aikami/constants';
import { WorkflowProfileListSchema, WorkflowTemplateListSchema } from '@aikami/schemas';
import type { WorkflowProfile, WorkflowTemplate } from '@aikami/types';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  assertProfileBindingsMatchTemplate,
  hashWorkflowTemplate,
  WorkflowValidationError,
  type WorkflowValidationIssue,
} from './workflow_compiler.ts';
import profileData from './workflow_profiles.json' with { type: 'json' };
import templateData from './workflow_templates.json' with { type: 'json' };

/** Mutable registries — the JSON seeds them, tests may register more. */
const _profiles = new Map<string, WorkflowProfile>();
const _templates = new Map<string, WorkflowTemplate>();

const _schemaError = (schema: TSchema, value: unknown): string => {
  const first = [...Value.Errors(schema, value)][0];
  return first ? `${first.instancePath || '/'}: ${first.message}` : 'unknown schema error';
};

/**
 * Validates and registers a graph template.
 *
 * @throws Error on a schema violation or a duplicate id.
 */
export const registerWorkflowTemplate = (raw: unknown): WorkflowTemplate => {
  if (!Value.Check(WorkflowTemplateListSchema.items, raw)) {
    throw new Error(
      `Invalid workflow template: ${_schemaError(WorkflowTemplateListSchema.items, raw)}`,
    );
  }
  const template = raw as WorkflowTemplate;
  if (_templates.has(template.id)) {
    throw new Error(`Duplicate workflow template id "${template.id}"`);
  }
  _templates.set(template.id, template);
  return template;
};

/**
 * Validates and registers a workflow profile.
 *
 * @throws Error on a schema violation, an unknown template, a duplicate id, or
 *         a semantic-input declaration that does not match its template.
 */
export const registerWorkflowProfile = (raw: unknown): WorkflowProfile => {
  if (!Value.Check(WorkflowProfileListSchema.items, raw)) {
    throw new Error(
      `Invalid workflow profile: ${_schemaError(WorkflowProfileListSchema.items, raw)}`,
    );
  }
  const profile = raw as WorkflowProfile;

  const template = _templates.get(profile.templateId);
  if (!template) {
    throw new Error(
      `Workflow profile "${profile.id}" names the unknown template "${profile.templateId}" — known templates: ${[..._templates.keys()].join(', ') || '(none)'}`,
    );
  }

  // Refuse before storing: a profile whose binding declaration drifts from its
  // template would otherwise "work" while sending prompts to the wrong node.
  assertProfileBindingsMatchTemplate({ profile, template });

  if (profile.capabilities.lora && profile.allowedLoras.length === 0) {
    throw new Error(
      `Workflow profile "${profile.id}" declares the lora capability but allows no LoRA — a profile must either name the exact LoRAs it accepts or declare the capability false`,
    );
  }
  for (const allowance of profile.allowedLoras) {
    if (allowance.modelFamily !== profile.modelFamily) {
      throw new Error(
        `Workflow profile "${profile.id}" allows the LoRA "${allowance.path}" trained for "${allowance.modelFamily}", but the profile's base family is "${profile.modelFamily}" — attaching a LoRA to the wrong base weights is refused at load`,
      );
    }
  }
  if (profile.status === 'experimental-blocked') {
    const blocked = profile.rights.find((rights) => rights.decision === 'blocked');
    if (!blocked) {
      throw new Error(
        `Workflow profile "${profile.id}" is experimental-blocked but records no blocked rights decision — an excluded profile must name the eligibility or licence finding that excludes it`,
      );
    }
  }

  if (_profiles.has(profile.id)) {
    throw new Error(`Duplicate workflow profile id "${profile.id}"`);
  }
  _profiles.set(profile.id, profile);
  return profile;
};

/** Every registered profile, in registration order. */
export const listWorkflowProfiles = (): readonly WorkflowProfile[] => [..._profiles.values()];

/** Looks up a profile by id. */
export const getWorkflowProfile = (id: string): WorkflowProfile | undefined => _profiles.get(id);

/** Looks up a template by id. */
export const getWorkflowTemplate = (id: string): WorkflowTemplate | undefined => _templates.get(id);

/** Every registered template, in registration order. */
export const listWorkflowTemplates = (): readonly WorkflowTemplate[] => [..._templates.values()];

/**
 * Looks up a profile, failing loudly when unknown.
 *
 * @throws WorkflowValidationError listing the known profile ids.
 */
export const requireWorkflowProfile = (id: string): WorkflowProfile => {
  const profile = _profiles.get(id);
  if (!profile) {
    throw new WorkflowValidationError({
      code: WORKFLOW_VALIDATION_CODES.profileNotDispatchable,
      message: `Unknown workflow profile "${id}" — known profiles: ${[..._profiles.keys()].join(', ') || '(none)'}`,
      details: { profileId: id },
    });
  }
  return profile;
};

/** The template a profile pins. */
export const requireWorkflowTemplateForProfile = (profile: WorkflowProfile): WorkflowTemplate => {
  const template = _templates.get(profile.templateId);
  if (!template) {
    throw new WorkflowValidationError({
      code: WORKFLOW_VALIDATION_CODES.templateHashMismatch,
      message: `Workflow profile "${profile.id}" pins the template "${profile.templateId}", which is not registered`,
      details: { profileId: profile.id, templateId: profile.templateId },
    });
  }
  return template;
};

/**
 * Verifies every registered profile's pinned `templateSha256` against its
 * template's current canonical hash.
 *
 * @returns one `template-hash-mismatch` issue per drifted profile.
 */
export const verifyWorkflowRegistryIntegrity = async (): Promise<
  readonly WorkflowValidationIssue[]
> => {
  const issues: WorkflowValidationIssue[] = [];
  for (const profile of listWorkflowProfiles()) {
    const template = requireWorkflowTemplateForProfile(profile);
    const actual = await hashWorkflowTemplate(template);
    if (actual !== profile.templateSha256) {
      issues.push({
        code: WORKFLOW_VALIDATION_CODES.templateHashMismatch,
        message: `Workflow profile "${profile.id}" pins template hash ${profile.templateSha256}, but "${template.id}" now hashes to ${actual} — bump the template revision and the profile together`,
      });
    }
  }
  return issues;
};

/**
 * Asserts registry integrity, throwing the first drift.
 *
 * @throws WorkflowValidationError with code `template-hash-mismatch`.
 */
export const assertWorkflowRegistryIntegrity = async (): Promise<void> => {
  const issues = await verifyWorkflowRegistryIntegrity();
  const first = issues[0];
  if (!first) {
    return;
  }
  throw new WorkflowValidationError({
    code: first.code,
    message: `${issues.length} workflow registry integrity issue(s); first: ${first.message}`,
  });
};

// ---------------------------------------------------------------------------
// Request-shaped resolution (AC-2)
// ---------------------------------------------------------------------------

/** The request-shaped facts that decide whether a profile may be used. */
export type WorkflowProfileRequestFacts = {
  /** Profile id, or omitted for the default profile. */
  profileId?: string;
  /** LoRA paths the request names. */
  loras?: readonly string[];
  /** Capability fields the request actually sets. */
  capabilities?: Partial<WorkflowProfile['capabilities']>;
};

/**
 * Resolves the profile + template a request may use, refusing anything the
 * profile does not genuinely support.
 *
 * @throws WorkflowValidationError for an unknown/blocked profile, a LoRA
 *         outside the allowlist, a LoRA from the wrong base family, or a
 *         capability the profile does not prove.
 */
export const resolveWorkflowProfileForRequest = (
  facts: WorkflowProfileRequestFacts = {},
): { profile: WorkflowProfile; template: WorkflowTemplate } => {
  const profile = requireWorkflowProfile(facts.profileId ?? DEFAULT_WORKFLOW_PROFILE_ID);

  if (profile.status === 'experimental-blocked') {
    const blocked = profile.rights.find((rights) => rights.decision === 'blocked');
    throw new WorkflowValidationError({
      code: WORKFLOW_VALIDATION_CODES.profileNotDispatchable,
      message: `Workflow profile "${profile.id}" is experimental-blocked and is never dispatchable${blocked ? `: ${blocked.scope} — ${blocked.note ?? 'blocked'}` : ''}`,
      details: { profileId: profile.id },
    });
  }

  const requestedLoras = facts.loras ?? [];
  if (requestedLoras.length > 0) {
    if (!profile.capabilities.lora) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.unsupportedCapability,
        message: `Workflow profile "${profile.id}" (${profile.modelFamily}) does not support LoRA — the request names ${requestedLoras.length} LoRA(s), which this profile's graph has no node to apply`,
        details: { profileId: profile.id },
      });
    }
    for (const lora of requestedLoras) {
      const allowance = profile.allowedLoras.find((entry) => entry.path === lora);
      if (!allowance) {
        throw new WorkflowValidationError({
          code: WORKFLOW_VALIDATION_CODES.unsupportedLora,
          message: `The LoRA "${lora}" is not in the allowlist for workflow profile "${profile.id}" (allowed: ${profile.allowedLoras.map((entry) => entry.path).join(', ') || '(none)'})`,
          details: { profileId: profile.id, lora },
        });
      }
      if (allowance.modelFamily !== profile.modelFamily) {
        throw new WorkflowValidationError({
          code: WORKFLOW_VALIDATION_CODES.loraFamilyMismatch,
          message: `The LoRA "${lora}" targets model family "${allowance.modelFamily}", but workflow profile "${profile.id}" runs "${profile.modelFamily}" — never attach a LoRA to another family's base weights`,
          details: { profileId: profile.id, lora },
        });
      }
    }
  }

  for (const [capability, requested] of Object.entries(facts.capabilities ?? {})) {
    if (requested !== true) {
      continue;
    }
    const supported = profile.capabilities[capability as keyof WorkflowProfile['capabilities']];
    if (supported !== true) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.unsupportedCapability,
        message: `The request sets "${capability}", but workflow profile "${profile.id}" does not prove it — the recipe would be silently downgraded at dispatch`,
        details: { profileId: profile.id, capability },
      });
    }
  }

  return { profile, template: requireWorkflowTemplateForProfile(profile) };
};

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** One reason a profile is not yet fully pinned for production use. */
export type WorkflowProfileReadinessIssue = {
  readonly code: WorkflowValidationCode;
  readonly message: string;
};

/**
 * Reports dependencies a profile declares but has not pinned to a hash, and
 * dependencies whose recorded hash cannot be checked without the installed
 * artifact. These are *advisory*: the hard pre-submit gate is the installed
 * node schema, which fails the actual submit when an artifact is missing.
 *
 * A producer must be able to answer "is this profile fully pinned?" without
 * running a GPU job, which is what this returns.
 */
export const describeWorkflowProfileReadiness = (
  profile: WorkflowProfile,
): readonly WorkflowProfileReadinessIssue[] => {
  const issues: WorkflowProfileReadinessIssue[] = [];
  for (const dependency of profile.dependencies) {
    if (dependency.required && dependency.sha256 === undefined) {
      issues.push({
        code: WORKFLOW_VALIDATION_CODES.missingDependency,
        message: `Workflow profile "${profile.id}" requires the ${dependency.role} "${dependency.filename}" but pins no SHA-256 — the artifact cannot be verified before use`,
      });
    }
  }
  return issues;
};

// Seed the registries from the data files. A malformed entry throws at import
// time — a broken profile must never reach a call site.
for (const entry of templateData as readonly unknown[]) {
  registerWorkflowTemplate(entry);
}
for (const entry of profileData as readonly unknown[]) {
  registerWorkflowProfile(entry);
}
