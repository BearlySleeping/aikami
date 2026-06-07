// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/src/lib/rest_client.ts
import { logger } from '$logger';
import type { ComfyUIPrompt, HistoryResponse, PromptResponse } from './types.ts';

/**
 * ComfyUI REST client — handles HTTP communication with a ComfyUI instance.
 *
 * Provides methods for queueing prompts, fetching generation history,
 * flushing VRAM, and checking server health.
 */
export class ComfyUIRestClient {
  private readonly _baseUrl: string;

  constructor(options: { baseUrl: string }) {
    this._baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  /**
   * Submits a workflow prompt to ComfyUI's /prompt endpoint.
   *
   * @returns The prompt_id that can be used to track generation via WS and /history.
   */
  async queuePrompt(options: { workflow: ComfyUIPrompt }): Promise<PromptResponse> {
    logger.debug('queuePrompt', { nodeCount: Object.keys(options.workflow).length });

    const url = `${this._baseUrl}/prompt`;
    const body = JSON.stringify({
      prompt: options.workflow,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `ComfyUI /prompt returned status ${response.status}: ${await response.text()}`,
      );
    }

    const data = (await response.json()) as PromptResponse;
    return data;
  }

  /**
   * Fetches generation history for a specific prompt_id from /history/{promptId}.
   *
   * The history includes output metadata (filenames, subfolders) for
   * any generated images.
   */
  async getHistory(options: { promptId: string }): Promise<HistoryResponse> {
    logger.debug('getHistory', { promptId: options.promptId });

    const url = `${this._baseUrl}/history/${options.promptId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `ComfyUI /history returned status ${response.status}: ${await response.text()}`,
      );
    }

    const data = (await response.json()) as HistoryResponse;
    return data;
  }

  /**
   * Dispatches a POST to /api/free to unload models and free VRAM.
   *
   * **AC2**: This is called immediately after a generation completes to
   * enforce strict VRAM eviction. The call is best-effort — failures
   * are logged but not thrown, since a failed eviction shouldn't block
   * the client.
   */
  async freeMemory(): Promise<void> {
    logger.debug('freeMemory');

    const url = `${this._baseUrl}/api/free`;
    const body = JSON.stringify({
      unload_models: true,
      free_memory: true,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!response.ok) {
        logger.warn('freeMemory: ComfyUI /api/free returned status', {
          status: response.status,
        });
      }
    } catch (error) {
      logger.warn('freeMemory: failed to call /api/free', { error });
    }
  }

  /**
   * Pings /system_stats to determine whether the ComfyUI server is healthy.
   *
   * **AC4**: Used by the Docker integration test to verify the container
   * is accepting connections after startup.
   */
  async checkHealth(): Promise<boolean> {
    logger.debug('checkHealth');

    try {
      const url = `${this._baseUrl}/system_stats`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return response.ok;
    } catch {
      return false;
    }
  }
}
