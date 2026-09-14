// packages/shared/schemas/src/lib/generation/workflow_profile.ts
//
// Versioned image-workflow profiles (C-520).
//
// A workflow profile is the *pinned* description of one generation graph:
// which engine builds it, which model family it belongs to, which weight
// artifacts must be installed (with hashes), which semantic inputs the graph
// accepts and where each one binds, and which capabilities are genuinely
// proven — as opposed to advertised.
//
// Why this exists: a ComfyUI "Load LoRA" node appearing in a tutorial proves
// nothing about the repository graph, the model family or the licence. The
// legacy SD-XL adapter declared `lora`, `mask`, `referenceImages` and
// `controlNet` unsupported, so a JSON edit could never make a LoRA work. A
// profile makes the claim explicit and *validatable* before any HTTP submit.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { type Static, Type } from 'typebox';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** How a profile may be selected. */
export const WorkflowProfileStatusSchema = Type.Union(
  [
    Type.Literal('production', { description: 'Selectable by default; safe for shipped recipes' }),
    Type.Literal('opt-in', {
      description: 'Selectable only by explicit id; requires installed pinned dependencies',
    }),
    Type.Literal('experimental-blocked', {
      description:
        'Never dispatchable — a research fixture whose weights/licence are unresolved. Listed so the exclusion is auditable rather than silent.',
    }),
  ],
  { description: 'Workflow profile lifecycle state' },
);

export type WorkflowProfileStatus = Static<typeof WorkflowProfileStatusSchema>;

/** Engines a profile may bind to. */
export const WorkflowProfileEngineSchema = Type.Union([
  Type.Literal('comfyui'),
  Type.Literal('sdcpp'),
]);

export type WorkflowProfileEngine = Static<typeof WorkflowProfileEngineSchema>;

// ---------------------------------------------------------------------------
// Dependencies — the exact artifacts the graph loads
// ---------------------------------------------------------------------------

/**
 * What a weight artifact is loaded as. `lora` is separate from the base
 * family on purpose: a LoRA trained for one family must never be attached to
 * another family's base weights.
 */
export const WorkflowDependencyRoleSchema = Type.Union([
  Type.Literal('checkpoint'),
  Type.Literal('unet'),
  Type.Literal('clip'),
  Type.Literal('vae'),
  Type.Literal('lora'),
]);

export type WorkflowDependencyRole = Static<typeof WorkflowDependencyRoleSchema>;

/**
 * One pinned weight artifact. `sha256` is optional because a profile may be
 * authored before the bytes are resolved — but `required: true` plus a missing
 * hash is what `blocked` profiles look like, and the registry reports the
 * exact missing dependency rather than dispatching an unverifiable graph.
 */
export const WorkflowDependencySchema = Type.Object({
  role: WorkflowDependencyRoleSchema,
  /** Filename as the engine's loader expects it. */
  filename: Type.String({ minLength: 1 }),
  /** Expected SHA-256 of the artifact, lowercase hex. */
  sha256: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
  /** The graph cannot run without this artifact. */
  required: Type.Boolean(),
  /** Model family the artifact was published for — guards LoRA misattachment. */
  modelFamily: Type.Optional(Type.String({ minLength: 1 })),
});

export type WorkflowDependency = Static<typeof WorkflowDependencySchema>;

// ---------------------------------------------------------------------------
// Semantic inputs — where a request value lands in the graph
// ---------------------------------------------------------------------------

/** The value kind a semantic input carries. Drives validation, not transport. */
export const WorkflowSemanticInputKindSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('image'),
  Type.Literal('number'),
  Type.Literal('integer'),
  Type.Literal('seed'),
  Type.Literal('boolean'),
]);

export type WorkflowSemanticInputKind = Static<typeof WorkflowSemanticInputKindSchema>;

/**
 * Binds one semantic input name to a concrete graph node input. A semantic
 * input may bind to several nodes (e.g. `referenceImage` → a load node and an
 * encode node), which is why this is a one-to-many mapping.
 */
export const WorkflowSemanticInputSchema = Type.Object({
  /** Semantic name the host supplies, e.g. `positivePrompt`, `referenceImage`. */
  name: Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9]*$' }),
  /** API-format node id in the graph template. */
  nodeId: Type.String({ pattern: '^[0-9]+$' }),
  /** Input key on that node, e.g. `text`, `image`, `strength`. */
  input: Type.String({ minLength: 1 }),
  kind: WorkflowSemanticInputKindSchema,
  /** The submit must fail when this input is absent. */
  required: Type.Boolean(),
  /** Upper bound for `image` inputs, in bytes of decoded payload. */
  maxPayloadBytes: Type.Optional(Type.Integer({ minimum: 1 })),
});

export type WorkflowSemanticInput = Static<typeof WorkflowSemanticInputSchema>;

// ---------------------------------------------------------------------------
// Capabilities and rights
// ---------------------------------------------------------------------------

/**
 * What this *profile* genuinely honours. Deliberately the same vocabulary as
 * `GenerationCapabilities` so a profile's claim can be compared with the
 * engine adapter's claim without a translation table.
 */
export const WorkflowProfileCapabilitiesSchema = Type.Object({
  negativePrompt: Type.Boolean(),
  seed: Type.Boolean(),
  sampler: Type.Boolean(),
  initImage: Type.Boolean(),
  mask: Type.Boolean(),
  referenceImages: Type.Boolean(),
  controlNet: Type.Boolean(),
  lora: Type.Boolean(),
});

export type WorkflowProfileCapabilities = Static<typeof WorkflowProfileCapabilitiesSchema>;

/** One reviewed rights decision for a specific use of the profile's weights. */
export const WorkflowRightsDecisionSchema = Type.Object({
  /** What is being decided, e.g. `weights-inference`, `output-redistribution`. */
  scope: Type.String({ minLength: 1 }),
  decision: Type.Union([
    Type.Literal('approved'),
    Type.Literal('pending'),
    Type.Literal('blocked'),
  ]),
  /** Primary sources the decision was read from. */
  sourceUrls: Type.Array(Type.String({ minLength: 1 })),
  reviewedAt: Type.Optional(Type.String({ minLength: 1 })),
  note: Type.Optional(Type.String({ minLength: 1 })),
});

export type WorkflowRightsDecision = Static<typeof WorkflowRightsDecisionSchema>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Sampler defaults a profile contributes when the request omits them. */
export const WorkflowProfileDefaultsSchema = Type.Object({
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  steps: Type.Integer({ minimum: 1 }),
  cfgScale: Type.Number({ minimum: 0 }),
  sampler: Type.String({ minLength: 1 }),
});

export type WorkflowProfileDefaults = Static<typeof WorkflowProfileDefaultsSchema>;

/**
 * A LoRA this profile will accept. The registry refuses a request that names a
 * LoRA outside this allowlist, before the graph is built — "the node exists"
 * is not a capability.
 */
export const WorkflowProfileLoraAllowanceSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  /** The family the LoRA was trained for; must match the profile family. */
  modelFamily: Type.String({ minLength: 1 }),
  sha256: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
});

export type WorkflowProfileLoraAllowance = Static<typeof WorkflowProfileLoraAllowanceSchema>;

/** A pinned, versioned image-workflow profile. */
export const WorkflowProfileSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  /** Profile revision, independent of the graph template revision. */
  version: Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' }),
  engine: WorkflowProfileEngineSchema,
  /** Model family key, e.g. `sd-xl`, `flux2-klein`. Not a marketing name. */
  modelFamily: Type.String({ pattern: '^[a-z0-9][a-z0-9.-]*$' }),
  /** Human-readable base model the family resolves to. */
  baseModel: Type.String({ minLength: 1 }),
  /** Key into the workflow-template data file. */
  templateId: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  /**
   * Expected SHA-256 of the canonicalised graph template. A template edited
   * without bumping the profile is refused at registry load.
   */
  templateSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  status: WorkflowProfileStatusSchema,
  dependencies: Type.Array(WorkflowDependencySchema, { minItems: 1 }),
  semanticInputs: Type.Array(WorkflowSemanticInputSchema, { minItems: 1 }),
  capabilities: WorkflowProfileCapabilitiesSchema,
  defaults: WorkflowProfileDefaultsSchema,
  /** LoRAs this profile will accept. Empty means "no LoRA is accepted". */
  allowedLoras: Type.Array(WorkflowProfileLoraAllowanceSchema),
  rights: Type.Array(WorkflowRightsDecisionSchema, { minItems: 1 }),
  notes: Type.Optional(Type.String({ minLength: 1 })),
});

export type WorkflowProfile = Static<typeof WorkflowProfileSchema>;

/**
 * A canonicalised graph template: API-format nodes plus the declared
 * dependencies each node loads. The `class_type` values are what the installed
 * node-schema introspection is checked against.
 */
export const WorkflowTemplateSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  /** Human-readable revision note; the hash is the identity, not this. */
  revision: Type.String({ minLength: 1 }),
  /**
   * API-format graph: node id → `{ class_type, inputs }`. Deliberately
   * `Type.Unknown` for `inputs` — the node-schema introspection validates the
   * actual shape against the installed nodes, and a JSON-level schema here
   * would be a second, weaker source of truth.
   */
  nodes: Type.Record(Type.String({ pattern: '^[0-9]+$' }), Type.Unknown()),
  /** Node ids whose output is fetched as the produced image. */
  outputNodeIds: Type.Array(Type.String({ pattern: '^[0-9]+$' }), { minItems: 1 }),
});

export type WorkflowTemplate = Static<typeof WorkflowTemplateSchema>;

/** The array shape of the workflow-template data file. */
export const WorkflowTemplateListSchema = Type.Array(WorkflowTemplateSchema);

/** The array shape of the workflow-profile data file. */
export const WorkflowProfileListSchema = Type.Array(WorkflowProfileSchema);
