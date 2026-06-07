// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/tests/workflow_builder.test.ts
import { describe, expect, test } from 'bun:test';
import type { ComfyUIPromptNode } from '../src/lib/types.ts';
import { ComfyUIWorkflowBuilder } from '../src/lib/workflow_builder.ts';

// ---------------------------------------------------------------------------
// AC1: Workflow Builder Injection
//   Given a base ComfyUI workflow definition
//   When the builder processes it for our pipeline
//   Then it successfully appends/replaces the output node with a
//   SaveImageWebsocket node linked to the final image tensor.
// ---------------------------------------------------------------------------

const makeBaseWorkflow = (): Record<string, ComfyUIPromptNode> => ({
  '1': {
    inputs: { width: 512, height: 512, batch_size: 1 },
    class_type: 'EmptyLatentImage',
  },
  '2': {
    inputs: { text: 'a cute cat', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
  },
  '3': {
    inputs: { text: 'ugly, blurry', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
  },
  '4': {
    inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
    class_type: 'CheckpointLoaderSimple',
  },
  '5': {
    inputs: {
      seed: 42,
      steps: 20,
      cfg: 7.0,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['2', 0],
      negative: ['3', 0],
      latent_image: ['1', 0],
    },
    class_type: 'KSampler',
  },
  '6': {
    inputs: {
      samples: ['5', 0],
      vae: ['4', 2],
    },
    class_type: 'VAEDecode',
  },
  '7': {
    inputs: {
      images: ['6', 0],
      filename_prefix: 'ComfyUI',
    },
    class_type: 'SaveImage',
  },
});

describe('ComfyUIWorkflowBuilder', () => {
  describe('injectSaveImageWebsocket', () => {
    test('appends a SaveImageWebsocket node linked to the final image output', () => {
      const builder = new ComfyUIWorkflowBuilder();
      const workflow = makeBaseWorkflow();

      const result = builder.injectSaveImageWebsocket(workflow);

      // AC1: The SaveImageWebsocket node must exist
      const wsNodeId = builder.getLastInjectedNodeId();
      if (!wsNodeId) {
        throw new Error('Expected a node ID to be injected');
      }

      const wsNode = result[wsNodeId];
      expect(wsNode).toBeTruthy();
      expect(wsNode.class_type).toBe('SaveImageWebsocket');

      // AC1: The node's `images` input must be linked to the final image tensor
      const imagesInput = wsNode.inputs.images;
      expect(Array.isArray(imagesInput)).toBe(true);
      const [linkedNodeId, linkedOutputIndex] = imagesInput as [string, number];
      expect(linkedNodeId).toBe('6'); // VAEDecode is the final image-producing node
      expect(linkedOutputIndex).toBe(0);
    });

    test('replaces an existing SaveImage node with SaveImageWebsocket', () => {
      const builder = new ComfyUIWorkflowBuilder();
      const workflow = makeBaseWorkflow();

      // The base workflow has node "7" = SaveImage with images: ["6", 0]
      const result = builder.injectSaveImageWebsocket(workflow);

      // SaveImageWebsocket should use the same image source as the old SaveImage
      const injectedId = builder.getLastInjectedNodeId();
      if (!injectedId) {
        throw new Error('Expected a node ID to be injected');
      }
      const wsNode = result[injectedId];
      const [linkedNodeId] = wsNode.inputs.images as [string, number];
      expect(linkedNodeId).toBe('6');

      // The original SaveImage node should be removed — no SaveImage class_type remains
      const saveImageNodes = Object.values(result).filter((n) => n.class_type === 'SaveImage');
      expect(saveImageNodes).toHaveLength(0);
    });

    test('detects the last image-producing node when no SaveImage exists', () => {
      const builder = new ComfyUIWorkflowBuilder();

      // Workflow that ends at VAEDecode with no SaveImage
      const workflow: Record<string, ComfyUIPromptNode> = {
        '1': {
          inputs: { width: 512, height: 512, batch_size: 1 },
          class_type: 'EmptyLatentImage',
        },
        '2': {
          inputs: {
            samples: ['1', 0],
            vae: ['3', 2],
          },
          class_type: 'VAEDecode',
        },
        '3': {
          inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
          class_type: 'CheckpointLoaderSimple',
        },
      };

      const result = builder.injectSaveImageWebsocket(workflow);

      const wsNodeId = builder.getLastInjectedNodeId();
      expect(wsNodeId).toBeTruthy();
      if (!wsNodeId) {
        throw new Error('Expected a node ID to be injected');
      }
      const wsNode = result[wsNodeId];
      expect(wsNode.class_type).toBe('SaveImageWebsocket');

      const [linkedNodeId] = wsNode.inputs.images as [string, number];
      expect(linkedNodeId).toBe('2'); // VAEDecode
    });

    test('throws when no image-producing node is found', () => {
      const builder = new ComfyUIWorkflowBuilder();

      // Workflow with only text nodes, no image output
      const workflow: Record<string, ComfyUIPromptNode> = {
        '1': {
          inputs: { text: 'hello' },
          class_type: 'CLIPTextEncode',
        },
      };

      expect(() => builder.injectSaveImageWebsocket(workflow)).toThrow(
        'No image-producing node found',
      );
    });

    test('does not mutate the original workflow', () => {
      const builder = new ComfyUIWorkflowBuilder();
      const workflow = makeBaseWorkflow();
      const originalKeys = Object.keys(workflow).sort();
      const originalSaveImage = { ...workflow['7'] };

      builder.injectSaveImageWebsocket(workflow);

      // Original workflow should be unchanged
      expect(Object.keys(workflow).sort()).toEqual(originalKeys);
      expect(workflow['7']).toEqual(originalSaveImage);
    });
  });

  describe('getLastInjectedNodeId', () => {
    test('returns undefined when no injection has happened', () => {
      const builder = new ComfyUIWorkflowBuilder();
      expect(builder.getLastInjectedNodeId()).toBeUndefined();
    });
  });
});
