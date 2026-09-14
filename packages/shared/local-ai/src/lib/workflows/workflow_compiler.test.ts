// packages/shared/local-ai/src/lib/workflows/workflow_compiler.test.ts
//
// C-520 AC-1: the semantic inputs reach the right graph nodes, and a graph the
// installed engine cannot execute fails *before* submit.
//
// Contract: C-520 Versioned image workflows and asset preparation
// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case fields
import { describe, expect, test } from 'bun:test';
import { WORKFLOW_VALIDATION_CODES } from '@aikami/constants';
import {
  assertCompiledWorkflowRunnable,
  assertProfileBindingsMatchTemplate,
  canonicaliseWorkflowTemplate,
  compileWorkflow,
  extractTemplateMarkers,
  hashWorkflowTemplate,
  type NodeSchema,
  readNodeInputOptions,
  validateCompiledWorkflow,
  WorkflowValidationError,
} from './workflow_compiler.ts';
import {
  getWorkflowTemplate,
  requireWorkflowProfile,
  resolveWorkflowProfileForRequest,
} from './workflow_profile_registry.ts';

/** A minimal installed-node document: exactly what the legacy profile needs. */
const sdxlNodeSchema = (options?: { checkpoint?: string }): NodeSchema => ({
  CheckpointLoaderSimple: {
    input: {
      required: { ckpt_name: [[options?.checkpoint ?? 'sd_xl_base_1.0.safetensors']] },
    },
  },
  KSampler: {
    input: {
      required: {
        seed: ['INT'],
        steps: ['INT'],
        cfg: ['FLOAT'],
        sampler_name: [['euler', 'dpmpp_2m']],
        scheduler: [['normal', 'simple']],
        denoise: ['FLOAT'],
        model: ['MODEL'],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
      },
    },
  },
  EmptyLatentImage: {
    input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT'] } },
  },
  CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
  VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
  SaveImage: { input: { required: { filename_prefix: ['STRING'], images: ['IMAGE'] } } },
});

const legacyProfile = () => requireWorkflowProfile('sdxl-legacy');

describe('C-520 AC-1: compiling a pinned profile', () => {
  test('the prompt reaches the text-encode node the profile names', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    expect(template).toBeDefined();
    if (!template) {
      return;
    }

    const compiled = compileWorkflow({
      profile,
      template,
      values: { positivePrompt: 'a weathered stone ward', negativePrompt: 'blurry' },
    });

    const positive = compiled.prompt['6'] as { inputs: Record<string, unknown> };
    const negative = compiled.prompt['7'] as { inputs: Record<string, unknown> };
    expect(positive.inputs.text).toBe('a weathered stone ward');
    expect(negative.inputs.text).toBe('blurry');
    expect(compiled.bindings).toContainEqual({
      name: 'positivePrompt',
      nodeId: '6',
      input: 'text',
    });
  });

  test('profile defaults fill the semantic inputs the caller omits', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const compiled = compileWorkflow({
      profile,
      template,
      values: { positivePrompt: 'prop' },
    });
    const sampler = compiled.prompt['3'] as { inputs: Record<string, unknown> };
    expect(sampler.inputs.steps).toBe(profile.defaults.steps);
    expect(sampler.inputs.cfg).toBe(profile.defaults.cfgScale);
    expect(sampler.inputs.sampler_name).toBe(profile.defaults.sampler);
  });

  test('a required semantic input that is not supplied is refused by name', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    let thrown: unknown;
    try {
      compileWorkflow({ profile, template, values: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkflowValidationError);
    expect((thrown as WorkflowValidationError).code).toBe(
      WORKFLOW_VALIDATION_CODES.missingSemanticInput,
    );
    expect((thrown as WorkflowValidationError).message).toContain('positivePrompt');
  });

  test('a dependency marker resolves to the profile’s pinned filename', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const compiled = compileWorkflow({ profile, template, values: { positivePrompt: 'prop' } });
    const loader = compiled.prompt['4'] as { inputs: Record<string, unknown> };
    expect(loader.inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
    expect(compiled.resolvedDependencies).toContainEqual({
      role: 'checkpoint',
      filename: 'sd_xl_base_1.0.safetensors',
    });
  });

  test('a payload above the profile’s declared bound is refused', () => {
    const profile = requireWorkflowProfile('flux2-klein-4b-comfyui');
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('flux template missing');
    }
    let thrown: unknown;
    try {
      compileWorkflow({
        profile,
        template,
        values: {
          positivePrompt: 'prop',
          referenceImage: 'x'.repeat(9_000_000),
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as WorkflowValidationError).code).toBe(
      WORKFLOW_VALIDATION_CODES.payloadTooLarge,
    );
  });

  test('the FLUX profile binds its reference image to the LoadImage node', () => {
    const profile = requireWorkflowProfile('flux2-klein-4b-comfyui');
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('flux template missing');
    }
    const compiled = compileWorkflow({
      profile,
      template,
      values: { positivePrompt: 'ward tree', referenceImage: 'data:image/png;base64,AAAA' },
    });
    const load = compiled.prompt['19'] as { inputs: Record<string, unknown> };
    expect(load.inputs.image).toBe('data:image/png;base64,AAAA');
  });

  test('the same profile compiles to identical bytes for identical inputs', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const first = compileWorkflow({ profile, template, values: { positivePrompt: 'ward' } });
    const second = compileWorkflow({ profile, template, values: { positivePrompt: 'ward' } });
    expect(JSON.stringify(first.prompt)).toBe(JSON.stringify(second.prompt));
  });
});

describe('C-520 AC-1: bindings must match the template', () => {
  test('every marker is discoverable with the node and input it sits on', () => {
    const template = getWorkflowTemplate('sdxl-legacy-v1');
    if (!template) {
      throw new Error('legacy template missing');
    }
    const markers = extractTemplateMarkers(template);
    expect(markers).toContainEqual({
      kind: 'semantic',
      name: 'positivePrompt',
      nodeId: '6',
      input: 'text',
    });
    expect(markers).toContainEqual({
      kind: 'dependency',
      name: 'checkpoint',
      nodeId: '4',
      input: 'ckpt_name',
    });
  });

  test('a declaration pointing at a different node than the marker is refused', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const drifted = {
      ...profile,
      semanticInputs: profile.semanticInputs.map((input) =>
        input.name === 'positivePrompt' ? { ...input, nodeId: '7' } : input,
      ),
    };
    expect(() => assertProfileBindingsMatchTemplate({ profile: drifted, template })).toThrow(
      /would not reach the graph node it names/,
    );
  });

  test('a declaration with no marker is refused as dead', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const drifted = {
      ...profile,
      semanticInputs: [
        ...profile.semanticInputs,
        {
          name: 'mask',
          nodeId: '3',
          input: 'denoise',
          kind: 'image' as const,
          required: false,
        },
      ],
    };
    expect(() => assertProfileBindingsMatchTemplate({ profile: drifted, template })).toThrow(
      /the declaration is dead/,
    );
  });

  test('canonicalisation ignores JSON key order, so the hash is stable', async () => {
    const template = getWorkflowTemplate('sdxl-legacy-v1');
    if (!template) {
      throw new Error('legacy template missing');
    }
    const reordered = {
      ...template,
      nodes: Object.fromEntries(Object.entries(template.nodes).reverse()),
    };
    expect(canonicaliseWorkflowTemplate(reordered)).toBe(canonicaliseWorkflowTemplate(template));
    expect(await hashWorkflowTemplate(reordered)).toBe(await hashWorkflowTemplate(template));
  });
});

describe('C-520 AC-1: the installed engine must be able to run the graph', () => {
  test('a complete install produces no issues', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const workflow = compileWorkflow({ profile, template, values: { positivePrompt: 'prop' } });
    expect(validateCompiledWorkflow({ workflow, nodeSchema: sdxlNodeSchema() })).toEqual([]);
  });

  test('an unknown node class fails before submit', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const workflow = compileWorkflow({ profile, template, values: { positivePrompt: 'prop' } });
    const schema = sdxlNodeSchema();
    const without = { ...schema } as Record<string, unknown>;
    delete without.EmptyLatentImage;

    const issues = validateCompiledWorkflow({ workflow, nodeSchema: without as NodeSchema });
    expect(issues.some((issue) => issue.code === WORKFLOW_VALIDATION_CODES.unknownNodeClass)).toBe(
      true,
    );
    expect(() =>
      assertCompiledWorkflowRunnable({ workflow, nodeSchema: without as NodeSchema }),
    ).toThrow(WorkflowValidationError);
  });

  test('an uninstalled checkpoint is a missing-dependency failure, not a 500 later', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const workflow = compileWorkflow({ profile, template, values: { positivePrompt: 'prop' } });
    const issues = validateCompiledWorkflow({
      workflow,
      nodeSchema: sdxlNodeSchema({ checkpoint: 'some_other_model.safetensors' }),
    });
    const dependencyIssue = issues.find(
      (issue) => issue.code === WORKFLOW_VALIDATION_CODES.missingDependency,
    );
    expect(dependencyIssue).toBeDefined();
    expect(dependencyIssue?.message).toContain('sd_xl_base_1.0.safetensors');
    expect(dependencyIssue?.message).toContain('not installed');
  });

  test('a node missing a required input is refused', () => {
    const profile = legacyProfile();
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('legacy template missing');
    }
    const workflow = compileWorkflow({ profile, template, values: { positivePrompt: 'prop' } });
    const schema = sdxlNodeSchema();
    const patched: NodeSchema = {
      ...schema,
      KSampler: {
        input: {
          required: { ...(schema.KSampler?.input?.required ?? {}), custom_required: ['INT'] },
        },
      },
    };
    const issues = validateCompiledWorkflow({ workflow, nodeSchema: patched });
    expect(
      issues.some(
        (issue) =>
          issue.code === WORKFLOW_VALIDATION_CODES.missingRequiredInput &&
          issue.input === 'custom_required',
      ),
    ).toBe(true);
  });

  test('the nested option list shape ComfyUI publishes is read correctly', () => {
    expect(readNodeInputOptions([['a.safetensors', 'b.safetensors']])).toEqual([
      'a.safetensors',
      'b.safetensors',
    ]);
    expect(readNodeInputOptions(['INT'])).toBeUndefined();
    expect(readNodeInputOptions(undefined)).toBeUndefined();
  });

  test('the FLUX profile needs its own five node classes installed', () => {
    const profile = requireWorkflowProfile('flux2-klein-4b-comfyui');
    const template = getWorkflowTemplate(profile.templateId);
    if (!template) {
      throw new Error('flux template missing');
    }
    const workflow = compileWorkflow({
      profile,
      template,
      values: {
        positivePrompt: 'ward tree',
        referenceImage: 'data:image/png;base64,AAAA',
        seed: 7,
      },
    });
    // Only the legacy SD classes are installed on this machine.
    const issues = validateCompiledWorkflow({ workflow, nodeSchema: sdxlNodeSchema() });
    const missingClasses = issues
      .filter((issue) => issue.code === WORKFLOW_VALIDATION_CODES.unknownNodeClass)
      .map((issue) => issue.message);
    expect(missingClasses.some((message) => message.includes('UNETLoader'))).toBe(true);
    expect(missingClasses.some((message) => message.includes('ReferenceLatent'))).toBe(true);
  });
});

describe('C-520 AC-1: profile resolution is the only way in', () => {
  test('the default profile stays the legacy SD path', () => {
    expect(resolveWorkflowProfileForRequest().profile.id).toBe('sdxl-legacy');
  });
});
