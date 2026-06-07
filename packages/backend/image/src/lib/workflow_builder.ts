// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/src/lib/workflow_builder.ts
import { logger } from '$logger';
import type { ComfyUIPromptNode } from './types.ts';

/**
 * ComfyUI Workflow Builder — constructs and modifies ComfyUI workflow graphs.
 *
 * Responsible for dynamically injecting a `SaveImageWebsocket` node at the end
 * of the image generation pipeline so that generated images are streamed via
 * WebSocket instead of saved to disk.
 */
export class ComfyUIWorkflowBuilder {
  /** The ID of the last SaveImageWebsocket node injected by this builder. */
  private _lastInjectedNodeId: string | undefined;

  /**
   * Injects a `SaveImageWebsocket` node into the workflow graph.
   *
   * The builder detects the final image-producing node in the workflow
   * (typically a VAEDecode or existing SaveImage), removes any existing
   * SaveImage/SaveImageWebsocket nodes, and appends a new SaveImageWebsocket
   * linked to the final image tensor output.
   *
   * Does NOT mutate the input — returns a shallow-cloned copy.
   */
  injectSaveImageWebsocket(
    workflow: Record<string, ComfyUIPromptNode>,
  ): Record<string, ComfyUIPromptNode> {
    logger.debug('injectSaveImageWebsocket', { nodeCount: Object.keys(workflow).length });

    // Shallow clone so we don't mutate the caller's object
    const result = { ...workflow };

    // Find the node that produces the final image tensor.
    //
    // Priority:
    // 1. A SaveImage/SaveImageWebsocket node — use its `images` input as the link target.
    // 2. A VAEDecode node — the standard final image stage.
    // 3. Any node with an `images` output field.
    const imageSource = this._findImageSourceNode(result);
    if (!imageSource) {
      throw new Error(
        'No image-producing node found in the workflow. ' +
          'Expected a VAEDecode, SaveImage, or similar node.',
      );
    }

    // Remove any existing SaveImage or SaveImageWebsocket nodes so we
    // don't leave stale output nodes.
    for (const [id, node] of Object.entries(result)) {
      if (node.class_type === 'SaveImage' || node.class_type === 'SaveImageWebsocket') {
        delete result[id];
      }
    }

    // Generate a new unique node ID
    const newNodeId = this._generateNodeId(result);
    const linkTarget: [string, number] =
      typeof imageSource === 'string'
        ? [imageSource, 0]
        : [imageSource.nodeId, imageSource.outputIndex];

    result[newNodeId] = {
      inputs: {
        images: linkTarget,
      },
      class_type: 'SaveImageWebsocket',
    };

    this._lastInjectedNodeId = newNodeId;
    return result;
  }

  /**
   * Returns the node ID of the last SaveImageWebsocket node injected by this builder.
   * Returns `undefined` if `injectSaveImageWebsocket` has not been called yet.
   */
  getLastInjectedNodeId(): string | undefined {
    return this._lastInjectedNodeId;
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Finds the source node whose image output should be connected to
   * the SaveImageWebsocket node.
   *
   * Returns either:
   * - A `string` — the node ID of the image-producing node (output index 0).
   * - `{ nodeId, outputIndex }` — if a specific output index is needed.
   * - `undefined` — if no image-producing node is found.
   */
  private _findImageSourceNode(
    workflow: Record<string, ComfyUIPromptNode>,
  ): string | { nodeId: string; outputIndex: number } | undefined {
    // 1. Look for SaveImage or SaveImageWebsocket — steal its image input link
    for (const [_id, node] of Object.entries(workflow)) {
      if (node.class_type === 'SaveImage' || node.class_type === 'SaveImageWebsocket') {
        const imagesInput = node.inputs.images;
        if (Array.isArray(imagesInput) && imagesInput.length >= 2) {
          const [linkedId, linkedIndex] = imagesInput as [string, number];
          return { nodeId: linkedId, outputIndex: linkedIndex };
        }
      }
    }

    // 2. Look for VAEDecode — the standard final image stage
    for (const [id, node] of Object.entries(workflow)) {
      if (node.class_type === 'VAEDecode') {
        return id;
      }
    }

    // 3. Fallback: any node that outputs `images`
    for (const [id, node] of Object.entries(workflow)) {
      if (node.class_type === 'SaveImageWebsocket') {
        continue; // Already handled above
      }
      // Heuristic: nodes with `images` in their class_type name or that
      // produce images (like PreviewImage, ImageScale, etc.)
      if (
        node.class_type.includes('Image') ||
        node.class_type.includes('VAE') ||
        node.class_type === 'KSampler'
      ) {
        return id;
      }
    }

    return undefined;
  }

  /**
   * Generates a unique node ID not currently used in the workflow.
   */
  private _generateNodeId(workflow: Record<string, ComfyUIPromptNode>): string {
    const numericIds = Object.keys(workflow).map(Number);
    let id = Math.max(1, ...numericIds) + 1;
    while (numericIds.includes(id)) {
      id++;
    }
    return String(id);
  }
}
