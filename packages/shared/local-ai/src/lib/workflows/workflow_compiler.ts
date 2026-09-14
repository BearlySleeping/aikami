// packages/shared/local-ai/src/lib/workflows/workflow_compiler.ts
//
// C-520: compile a pinned workflow template into an API-format ComfyUI graph.
//
// Two guarantees are enforced here, both *before* any HTTP submission:
//
//   1. **Bindings are real.** Every `$sem:<name>` marker in the template must
//      be declared by the profile as a semantic input on exactly that node and
//      input, and every declared input must have a marker. A profile whose
//      declaration drifts from its template is refused at registry load.
//   2. **The installed engine can actually run it.** `validateCompiledWorkflow`
//      checks the graph against ComfyUI's `/object_info` node schema: an
//      unknown node class, a missing required input, or a weight filename that
//      the installed loaders do not offer is a typed failure, not a 500 from
//      the engine twenty seconds later.
//
// The compiler is pure: no fetch, no filesystem, no clock. Host adapters fetch
// `/object_info` and pass it in.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { WORKFLOW_VALIDATION_CODES, type WorkflowValidationCode } from '@aikami/constants';
import type { WorkflowProfile, WorkflowSemanticInput, WorkflowTemplate } from '@aikami/types';
import { sha256Hex } from '../generated_asset.ts';

/** Marker prefix resolving to a profile dependency's filename. */
const DEPENDENCY_MARKER = '$dep:';

/** Marker prefix resolving to a supplied semantic input. */
const SEMANTIC_MARKER = '$sem:';

/**
 * A refused workflow, carrying the stable code a caller branches on. Never
 * thrown for a *transient* engine problem — only for a graph the engine cannot
 * accept.
 */
export class WorkflowValidationError extends Error {
  readonly code: WorkflowValidationCode;

  readonly details: Readonly<Record<string, string>>;

  constructor(options: {
    code: WorkflowValidationCode;
    message: string;
    details?: Record<string, string>;
  }) {
    super(options.message);
    this.name = 'WorkflowValidationError';
    this.code = options.code;
    this.details = options.details ?? {};
  }
}

/** One semantic input actually written into the compiled graph. */
export type WorkflowSemanticBinding = {
  readonly name: string;
  readonly nodeId: string;
  readonly input: string;
};

/** The result of compiling a profile template for one request. */
export type CompiledWorkflow = {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly templateId: string;
  readonly templateSha256: string;
  /** API-format graph — node id → `{ class_type, inputs }`. */
  readonly prompt: Record<string, unknown>;
  /** Node ids whose output carries the produced image. */
  readonly outputNodeIds: readonly string[];
  /** Semantic inputs written, in profile declaration order. */
  readonly bindings: readonly WorkflowSemanticBinding[];
  /** Dependency filenames the graph resolved. */
  readonly resolvedDependencies: readonly WorkflowDependencyResolution[];
};

/** One `$dep:` marker resolved to an installed-artifact filename. */
export type WorkflowDependencyResolution = {
  readonly role: string;
  readonly filename: string;
  readonly sha256?: string;
};

/** A value supplied for one semantic input name. */
export type WorkflowInputValues = Readonly<Record<string, string | number | boolean | undefined>>;

/** One refusal produced by {@link validateCompiledWorkflow}. */
export type WorkflowValidationIssue = {
  readonly code: WorkflowValidationCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly input?: string;
};

/**
 * Deterministically serialises a template. Keys are sorted at every level so
 * the hash is stable against JSON key churn in the data file — two templates
 * that differ only in key order are the same template.
 */
export const canonicaliseWorkflowTemplate = (template: WorkflowTemplate): string => {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(sortValue);
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
    }
    return value;
  };
  return JSON.stringify(sortValue(template));
};

/** The pinned hash of a template, matching `WorkflowProfile.templateSha256`. */
export const hashWorkflowTemplate = (template: WorkflowTemplate): Promise<string> =>
  sha256Hex(new TextEncoder().encode(canonicaliseWorkflowTemplate(template)));

/** Every `$sem:`/`$dep:` marker occurrence found in a template. */
type TemplateMarker = {
  readonly kind: 'semantic' | 'dependency';
  readonly name: string;
  readonly nodeId: string;
  readonly input: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Walks a template and returns every marker with the node/input it sits on.
 * Link values (`["4", 0]`) are left untouched — only string markers count.
 */
export const extractTemplateMarkers = (template: WorkflowTemplate): readonly TemplateMarker[] => {
  const markers: TemplateMarker[] = [];
  for (const [nodeId, rawNode] of Object.entries(template.nodes)) {
    if (!isPlainObject(rawNode)) {
      continue;
    }
    const inputs = rawNode.inputs;
    if (!isPlainObject(inputs)) {
      continue;
    }
    for (const [input, value] of Object.entries(inputs)) {
      if (typeof value !== 'string') {
        continue;
      }
      if (value.startsWith(SEMANTIC_MARKER)) {
        markers.push({
          kind: 'semantic',
          name: value.slice(SEMANTIC_MARKER.length),
          nodeId,
          input,
        });
        continue;
      }
      if (value.startsWith(DEPENDENCY_MARKER)) {
        markers.push({
          kind: 'dependency',
          name: value.slice(DEPENDENCY_MARKER.length),
          nodeId,
          input,
        });
      }
    }
  }
  return markers;
};

/**
 * Cross-checks a profile's declared semantic inputs against its template.
 *
 * @throws WorkflowValidationError when a marker has no declaration, a
 *         declaration has no marker, or a declaration points at a different
 *         node/input than the marker does.
 */
export const assertProfileBindingsMatchTemplate = (options: {
  profile: WorkflowProfile;
  template: WorkflowTemplate;
}): void => {
  const markers = extractTemplateMarkers(options.template).filter(
    (marker) => marker.kind === 'semantic',
  );
  const declared = new Map(options.profile.semanticInputs.map((input) => [input.name, input]));

  for (const marker of markers) {
    const input = declared.get(marker.name);
    if (!input) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.missingSemanticInput,
        message: `Workflow profile "${options.profile.id}" template "${options.template.id}" binds "${marker.name}" on node ${marker.nodeId}.${marker.input}, but the profile does not declare that semantic input`,
        details: { profileId: options.profile.id, semanticInput: marker.name },
      });
    }
    if (input.nodeId !== marker.nodeId || input.input !== marker.input) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.missingSemanticInput,
        message: `Workflow profile "${options.profile.id}" declares "${marker.name}" on node ${input.nodeId}.${input.input}, but template "${options.template.id}" binds it on node ${marker.nodeId}.${marker.input} — the semantic input would not reach the graph node it names`,
        details: { profileId: options.profile.id, semanticInput: marker.name },
      });
    }
  }

  for (const input of options.profile.semanticInputs) {
    if (!markers.some((marker) => marker.name === input.name)) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.missingRequiredInput,
        message: `Workflow profile "${options.profile.id}" declares the semantic input "${input.name}", but template "${options.template.id}" has no marker for it — the declaration is dead`,
        details: { profileId: options.profile.id, semanticInput: input.name },
      });
    }
  }
};

const dependencyForRole = (
  profile: WorkflowProfile,
  role: string,
): WorkflowProfile['dependencies'][number] | undefined =>
  profile.dependencies.find((dependency) => dependency.role === role);

const resolveMarker = (options: {
  marker: string;
  profile: WorkflowProfile;
  values: WorkflowInputValues;
  declared?: WorkflowSemanticInput;
}): string | number | boolean => {
  const { marker, profile, values, declared } = options;
  if (marker.startsWith(DEPENDENCY_MARKER)) {
    const role = marker.slice(DEPENDENCY_MARKER.length);
    const dependency = dependencyForRole(profile, role);
    if (!dependency) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.missingDependency,
        message: `Workflow profile "${profile.id}" template asks for a "${role}" dependency the profile does not declare`,
        details: { profileId: profile.id, role },
      });
    }
    return dependency.filename;
  }

  const name = marker.slice(SEMANTIC_MARKER.length);
  const value = values[name];
  if (value === undefined) {
    if (declared?.required) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.missingSemanticInput,
        message: `Workflow profile "${profile.id}" requires the semantic input "${name}" and none was supplied`,
        details: { profileId: profile.id, semanticInput: name },
      });
    }
    return '';
  }

  if (
    typeof value === 'string' &&
    declared?.maxPayloadBytes !== undefined &&
    value.length > declared.maxPayloadBytes
  ) {
    // Payload bound is measured on the encoded string, which is what reaches
    // the wire — a base64 data URL is ~4/3 its decoded size.
    throw new WorkflowValidationError({
      code: WORKFLOW_VALIDATION_CODES.payloadTooLarge,
      message: `Semantic input "${name}" is ${value.length} bytes, above the profile's ${declared.maxPayloadBytes}-byte bound`,
      details: { profileId: profile.id, semanticInput: name },
    });
  }

  return value;
};

/**
 * Compiles a profile + template + supplied values into a dispatchable graph.
 *
 * Profile `defaults` fill any declared semantic input the caller omitted, so
 * a request only has to supply what genuinely varies.
 *
 * @throws WorkflowValidationError when a required input is missing, a marker
 *         has no matching declaration, or a dependency role is undeclared.
 */
export const compileWorkflow = (options: {
  profile: WorkflowProfile;
  template: WorkflowTemplate;
  values?: WorkflowInputValues;
  /** Overrides applied on top of the profile defaults. */
  defaultsOverride?: Partial<WorkflowProfile['defaults']>;
}): CompiledWorkflow => {
  const { profile, template } = options;
  assertProfileBindingsMatchTemplate({ profile, template });

  const defaults = { ...profile.defaults, ...(options.defaultsOverride ?? {}) };
  const declared = new Map(profile.semanticInputs.map((input) => [input.name, input]));

  const values: Record<string, string | number | boolean | undefined> = {
    width: defaults.width,
    height: defaults.height,
    steps: defaults.steps,
    cfgScale: defaults.cfgScale,
    sampler: defaults.sampler,
    denoise: 1,
    ...options.values,
  };

  const prompt: Record<string, unknown> = {};
  const bindings: WorkflowSemanticBinding[] = [];
  const resolvedRoles = new Map<string, WorkflowDependencyResolution>();

  for (const [nodeId, rawNode] of Object.entries(template.nodes)) {
    if (!isPlainObject(rawNode)) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.unknownNodeClass,
        message: `Template "${template.id}" node ${nodeId} is not an object with a class_type`,
        details: { templateId: template.id, nodeId },
      });
    }
    const classType = rawNode.class_type;
    if (typeof classType !== 'string' || classType.length === 0) {
      throw new WorkflowValidationError({
        code: WORKFLOW_VALIDATION_CODES.unknownNodeClass,
        message: `Template "${template.id}" node ${nodeId} has no class_type`,
        details: { templateId: template.id, nodeId },
      });
    }

    const rawInputs = isPlainObject(rawNode.inputs) ? rawNode.inputs : {};
    const inputs: Record<string, unknown> = {};
    for (const [input, value] of Object.entries(rawInputs)) {
      if (
        typeof value !== 'string' ||
        (!value.startsWith(SEMANTIC_MARKER) && !value.startsWith(DEPENDENCY_MARKER))
      ) {
        inputs[input] = value;
        continue;
      }
      const name = value.slice(SEMANTIC_MARKER.length);
      const resolved = resolveMarker({
        marker: value,
        profile,
        values,
        ...(value.startsWith(SEMANTIC_MARKER) ? { declared: declared.get(name) } : {}),
      });
      inputs[input] = resolved;

      if (value.startsWith(SEMANTIC_MARKER)) {
        bindings.push({ name, nodeId, input });
        continue;
      }
      const role = value.slice(DEPENDENCY_MARKER.length);
      const dependency = dependencyForRole(profile, role);
      resolvedRoles.set(role, {
        role,
        filename: dependency?.filename ?? String(resolved),
        ...(dependency?.sha256 === undefined ? {} : { sha256: dependency.sha256 }),
      });
    }

    // biome-ignore lint/style/useNamingConvention: `class_type` is ComfyUI's wire field name
    prompt[nodeId] = { class_type: classType, inputs };
  }

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    templateId: template.id,
    templateSha256: profile.templateSha256,
    prompt,
    outputNodeIds: template.outputNodeIds,
    bindings,
    resolvedDependencies: [...resolvedRoles.values()],
  };
};

// ---------------------------------------------------------------------------
// Installed-schema validation
// ---------------------------------------------------------------------------

/** One entry of ComfyUI's `/object_info` node schema, narrowed to what we read. */
export type NodeSchemaEntry = {
  readonly input?: {
    readonly required?: Record<string, unknown>;
    readonly optional?: Record<string, unknown>;
  };
};

/** The `/object_info` document, narrowed. */
export type NodeSchema = Readonly<Record<string, NodeSchemaEntry>>;

/**
 * Loader inputs whose accepted values are a closed filename list in
 * `/object_info`. A filename absent from that list is not installed.
 */
const MODEL_FILE_INPUTS: Readonly<Record<string, string>> = {
  // biome-ignore lint/style/useNamingConvention: ComfyUI's /object_info keys are snake_case wire names
  ckpt_name: 'checkpoint',
  // biome-ignore lint/style/useNamingConvention: ComfyUI wire name
  unet_name: 'unet',
  // biome-ignore lint/style/useNamingConvention: ComfyUI wire name
  vae_name: 'vae',
  // biome-ignore lint/style/useNamingConvention: ComfyUI wire name
  clip_name: 'clip',
  // biome-ignore lint/style/useNamingConvention: ComfyUI wire name
  lora_name: 'lora',
};

/**
 * Reads the accepted-value list for one loader input.
 *
 * ComfyUI declares these as a NESTED array — `[[ "a.safetensors", "b.safetensors" ]]`
 * — where the outer element carries sibling metadata. The pre-existing
 * `listModels()` had to special-case exactly this, so the shape is handled
 * once, here.
 */
export const readNodeInputOptions = (spec: unknown): readonly string[] | undefined => {
  if (!Array.isArray(spec)) {
    return undefined;
  }
  // ComfyUI publishes two shapes here: a nested list of accepted filenames
  // (`[[ "a.safetensors" ]]`) and a flat *type* declaration (`["INT"]`,
  // `["STRING", { multiline: true }]`). Only a list of two or more strings, or
  // a nested list, is an option set — a one-element flat list is a type.
  const nested = Array.isArray(spec[0]);
  const inner: readonly unknown[] = nested ? (spec[0] as readonly unknown[]) : spec;
  const strings = inner.filter((entry): entry is string => typeof entry === 'string');
  if (strings.length !== inner.length) {
    return undefined;
  }
  if (!nested && strings.length < 2) {
    return undefined;
  }
  return strings.length === 0 ? undefined : strings;
};

/**
 * Validates a compiled graph against the installed node schema.
 *
 * Returns every issue rather than throwing on the first, so a caller can
 * report the whole reason a profile is unusable in one pass.
 */
export const validateCompiledWorkflow = (options: {
  workflow: CompiledWorkflow;
  nodeSchema: NodeSchema;
}): readonly WorkflowValidationIssue[] => {
  const issues: WorkflowValidationIssue[] = [];

  for (const [nodeId, rawNode] of Object.entries(options.workflow.prompt)) {
    if (!isPlainObject(rawNode)) {
      continue;
    }
    const classType = rawNode.class_type;
    if (typeof classType !== 'string') {
      continue;
    }
    const schemaEntry = options.nodeSchema[classType];
    if (!schemaEntry) {
      issues.push({
        code: WORKFLOW_VALIDATION_CODES.unknownNodeClass,
        message: `Installed ComfyUI exposes no node class "${classType}" (required by node ${nodeId}) — refusing to submit a graph the engine cannot execute`,
        nodeId,
      });
      continue;
    }

    const required = schemaEntry.input?.required ?? {};
    const inputs = isPlainObject(rawNode.inputs) ? rawNode.inputs : {};

    for (const [input, spec] of Object.entries(required)) {
      if (!(input in inputs)) {
        issues.push({
          code: WORKFLOW_VALIDATION_CODES.missingRequiredInput,
          message: `Node ${nodeId} (${classType}) is missing the required input "${input}"`,
          nodeId,
          input,
        });
        continue;
      }
      const accepted = readNodeInputOptions(spec);
      if (!accepted) {
        continue;
      }
      const supplied = inputs[input];
      if (typeof supplied !== 'string' || !accepted.includes(supplied)) {
        const role = MODEL_FILE_INPUTS[input];
        issues.push({
          code:
            role === undefined
              ? WORKFLOW_VALIDATION_CODES.missingRequiredInput
              : WORKFLOW_VALIDATION_CODES.missingDependency,
          message:
            role === undefined
              ? `Node ${nodeId} (${classType}) input "${input}" is "${String(supplied)}", which the installed node does not offer`
              : `The "${role}" artifact "${String(supplied)}" is not installed — the installed ${classType} accepts: ${accepted.join(', ') || '(none)'}`,
          nodeId,
          input,
        });
      }
    }
  }

  return issues;
};

/**
 * Validates a compiled graph, throwing the first issue.
 *
 * @throws WorkflowValidationError carrying the stable issue code.
 */
export const assertCompiledWorkflowRunnable = (options: {
  workflow: CompiledWorkflow;
  nodeSchema: NodeSchema;
}): void => {
  const issues = validateCompiledWorkflow(options);
  const first = issues[0];
  if (!first) {
    return;
  }
  throw new WorkflowValidationError({
    code: first.code,
    message: `${issues.length} workflow validation issue(s); first: ${first.message}`,
    details: {
      profileId: options.workflow.profileId,
      ...(first.nodeId === undefined ? {} : { nodeId: first.nodeId }),
      ...(first.input === undefined ? {} : { input: first.input }),
    },
  });
};
