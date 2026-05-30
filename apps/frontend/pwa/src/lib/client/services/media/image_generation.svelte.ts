// apps/frontend/pwa/src/lib/client/services/media/image-generation.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

export type ImageGenerationOptions = BaseFrontendClassOptions;

export type ImageGenerationResult = {
  url: string;
  isDemo: boolean;
};

export type ImageGenerationServiceInterface = BaseFrontendClassInterface & {
  /**
   * Generates an image based on a prompt.
   * @param options - Configuration object.
   * @param options.prompt The description of the image to generate.
   * @returns A promise that resolves to the image URL.
   */
  generateImage(options: { prompt: string }): Promise<ImageGenerationResult>;

  /**
   * Checks if the service is running in demo/emulator mode.
   */
  isDemoMode(): boolean;
};

class ImageGenerationService
  extends BaseFrontendClass<ImageGenerationOptions>
  implements ImageGenerationServiceInterface
{
  private isDemo = true;

  isDemoMode(): boolean {
    return this.isDemo;
  }

  async generateImage(options: { prompt: string }): Promise<ImageGenerationResult> {
    this.debug('generateImage', options);
    const { prompt } = options;

    if (this.isDemo) {
      this.debug('generateImage: demo mode - returning mock image');
      return {
        url: `https://placehold.co/600x400?text=${encodeURIComponent(prompt.slice(0, 20))}`,
        isDemo: true,
      };
    }

    try {
      const response = await fetch('/api/image-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        throw new Error(`Image generation failed: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        url: data.url,
        isDemo: false,
      };
    } catch (error) {
      this.error('generateImage failed', error);
      throw error;
    }
  }
}

export const imageGenerationService: ImageGenerationServiceInterface = new ImageGenerationService({
  className: 'ImageGenerationService',
});
