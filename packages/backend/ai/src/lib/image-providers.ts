import { DEFAULT_IMAGE_SIZES, ImageSize, ImageStyle, STYLE_PRESETS } from '@aikami/schemas';
import type {
  ImageGenerationProviderInterface,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderCapabilities,
} from '$types/index.ts';

export class DallEProvider implements ImageGenerationProviderInterface {
  readonly name = 'DALL-E (via Google AI)';
  readonly provider = 'dalle' as const;
  readonly supportsStyles = true;
  readonly supportsNegativePrompt = false;
  readonly supportsCustomDimensions = false;
  readonly maxResolution = { width: 1024, height: 1024 };

  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_AI_API_KEY || '';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    const size = request.size || '1024x1024';
    const dimensions = DEFAULT_IMAGE_SIZES[size] || DEFAULT_IMAGE_SIZES['1024x1024'];

    let prompt = request.prompt;
    if (request.style && request.style !== 'natural') {
      const stylePrefix = STYLE_PRESETS[request.style];
      if (stylePrefix) {
        prompt = `${request.prompt}, ${stylePrefix}`;
      }
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3-0-generate-002:predict?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          number_of_images: 1,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`DALL-E API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { predictions?: { uri?: string }[] };
    const imageUrl = data.predictions?.[0]?.uri || '';

    return {
      id: crypto.randomUUID(),
      imageUrl,
      provider: 'dalle',
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      seed: request.seed,
      generationTime: Date.now() - startTime,
      width: dimensions.width,
      height: dimensions.height,
      createdAt: new Date().toISOString(),
    };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'dalle',
      name: this.name,
      supportedStyles: ['natural', 'vivid', 'fantasy'],
      supportedSizes: ['1024x1024', '1792x1024', '1024x1792'],
      supportsNegativePrompt: this.supportsNegativePrompt,
      supportsCustomDimensions: this.supportsCustomDimensions,
      supportsSeed: false,
      supportsSteps: false,
      maxResolution: this.maxResolution,
      avgGenerationTime: 5000,
    };
  }
}

export class StableDiffusionProvider implements ImageGenerationProviderInterface {
  readonly name = 'Stable Diffusion';
  readonly provider = 'stable-diffusion' as const;
  readonly supportsStyles = true;
  readonly supportsNegativePrompt = true;
  readonly supportsCustomDimensions = true;
  readonly maxResolution = { width: 2048, height: 2048 };

  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.SD_API_URL || 'http://localhost:7860';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    const width =
      request.width ||
      (request.size ? DEFAULT_IMAGE_SIZES[request.size]?.width : undefined) ||
      1024;
    const height =
      request.height ||
      (request.size ? DEFAULT_IMAGE_SIZES[request.size]?.height : undefined) ||
      1024;

    let prompt = request.prompt;
    if (request.style && request.style !== 'natural') {
      const stylePrefix = STYLE_PRESETS[request.style];
      if (stylePrefix) {
        prompt = `${request.prompt}, ${stylePrefix}`;
      }
    }

    const payload = {
      prompt,
      negative_prompt: request.negativePrompt || '',
      width,
      height,
      steps: request.steps || 30,
      cfg_scale: request.cfgScale || 7,
      seed: request.seed ?? -1,
    };

    const response = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Stable Diffusion API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { images?: string[]; seed?: number };
    const imageBase64 = data.images?.[0];
    if (!imageBase64) {
      throw new Error('No image returned from Stable Diffusion');
    }

    const imageUrl = `data:image/png;base64,${imageBase64}`;

    return {
      id: crypto.randomUUID(),
      imageUrl,
      provider: 'stable-diffusion',
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      seed: data.seed || request.seed,
      generationTime: Date.now() - startTime,
      width,
      height,
      createdAt: new Date().toISOString(),
    };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'stable-diffusion',
      name: this.name,
      supportedStyles: [
        'natural',
        'fantasy',
        'realistic',
        'anime',
        'digital-art',
        'photographic',
        '3d-render',
        'pixel-art',
        'oil-painting',
        'watercolor',
      ],
      supportedSizes: ['512x512', '1024x1024', '1024x1792', '1792x1024'],
      supportsNegativePrompt: this.supportsNegativePrompt,
      supportsCustomDimensions: this.supportsCustomDimensions,
      supportsSeed: true,
      supportsSteps: true,
      maxResolution: this.maxResolution,
      avgGenerationTime: 15000,
    };
  }
}

export interface ComfyUIWorkflow {
  nodes: ComfyUINode[];
  connections: [number, string, number, string][];
}

export interface ComfyUINode {
  id: number;
  type: string;
  pos?: [number, number];
  size?: [number, number];
  widgets_values?: unknown[];
}

export class ComfyUIProvider implements ImageGenerationProviderInterface {
  readonly name = 'ComfyUI';
  readonly provider = 'comfyui' as const;
  readonly supportsStyles = true;
  readonly supportsNegativePrompt = true;
  readonly supportsCustomDimensions = true;
  readonly maxResolution = { width: 4096, height: 4096 };

  private baseUrl: string;
  private workflowTemplates: Map<string, ComfyUIWorkflow>;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.COMFYUI_API_URL || 'http://localhost:8188';
    this.workflowTemplates = new Map();
    this.initWorkflowTemplates();
  }

  private initWorkflowTemplates(): void {
    const baseTextToImageWorkflow: ComfyUIWorkflow = {
      nodes: [
        { id: 1, type: 'TextInput', widgets_values: ['positive prompt'] },
        { id: 2, type: 'TextInput', widgets_values: ['negative prompt'] },
        { id: 3, type: 'CLIPTextEncode' },
        { id: 4, type: 'CLIPTextEncode' },
        { id: 5, type: 'KSampler' },
        { id: 6, type: 'VAEDecode' },
        { id: 7, type: 'SaveImage' },
      ],
      connections: [],
    };

    this.workflowTemplates.set('text-to-image', baseTextToImageWorkflow);
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    const width =
      request.width ||
      (request.size ? DEFAULT_IMAGE_SIZES[request.size]?.width : undefined) ||
      1024;
    const height =
      request.height ||
      (request.size ? DEFAULT_IMAGE_SIZES[request.size]?.height : undefined) ||
      1024;

    let prompt = request.prompt;
    if (request.style && request.style !== 'natural') {
      const stylePrefix = STYLE_PRESETS[request.style];
      if (stylePrefix) {
        prompt = `${request.prompt}, ${stylePrefix}`;
      }
    }

    const workflow = this.buildTextToImageWorkflow({
      positivePrompt: prompt,
      negativePrompt: request.negativePrompt || '',
      width,
      height,
      steps: request.steps || 30,
      cfgScale: request.cfgScale || 7,
      seed: request.seed || Math.floor(Math.random() * 1000000),
    });

    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!response.ok) {
      throw new Error(`ComfyUI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { prompt_id: string };
    const promptId = data.prompt_id;

    const imageUrl = await this.waitForCompletion(promptId);

    const seedValue = workflow.nodes.find((n) => n.type === 'KSampler')?.widgets_values?.[5];

    return {
      id: crypto.randomUUID(),
      imageUrl,
      provider: 'comfyui',
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      seed: typeof seedValue === 'number' ? seedValue : undefined,
      generationTime: Date.now() - startTime,
      width,
      height,
      createdAt: new Date().toISOString(),
    };
  }

  private buildTextToImageWorkflow(options: {
    positivePrompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    seed: number;
  }): ComfyUIWorkflow {
    return {
      nodes: [
        { id: 1, type: 'TextInput', widgets_values: [options.positivePrompt] },
        { id: 2, type: 'TextInput', widgets_values: [options.negativePrompt] },
        { id: 3, type: 'CheckpointLoaderSimple', widgets_values: ['sd_xl_base_1.0.safetensors'] },
        { id: 4, type: 'CLIPTextEncode' },
        { id: 5, type: 'CLIPTextEncode' },
        {
          id: 6,
          type: 'EmptyLatentImage',
          widgets_values: [1, Math.floor(options.width / 8), Math.floor(options.height / 8), 1],
        },
        {
          id: 7,
          type: 'KSampler',
          widgets_values: [
            0,
            options.seed,
            options.steps,
            options.cfgScale,
            'euler',
            'normal',
            1.0,
          ],
        },
        { id: 8, type: 'VAEDecode' },
        { id: 9, type: 'VAEEncode' },
        { id: 10, type: 'SaveImage', widgets_values: [`output_${options.seed}`] },
      ],
      connections: [
        [3, 0, 4, 0],
        [3, 0, 5, 0],
        [3, 0, 9, 0],
        [4, 0, 7, 1],
        [5, 0, 7, 2],
        [6, 0, 7, 0],
        [7, 0, 9, 1],
        [9, 0, 8, 1],
        [8, 0, 10, 0],
      ],
    };
  }

  private async waitForCompletion(promptId: string, maxAttempts = 60): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const historyResponse = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (historyResponse.ok) {
          const history = (await historyResponse.json()) as Record<
            string,
            {
              status?: { completed?: boolean };
              outputs?: Record<string, { images?: { filename: string; subfolder: string }[] }>;
            }
          >;
          if (history[promptId]?.status?.completed) {
            const outputs = history[promptId].outputs;
            for (const nodeId of Object.keys(outputs)) {
              const node = outputs[nodeId];
              if (node.images) {
                const image = node.images[0];
                return `${this.baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${image.subfolder}`;
              }
            }
          }
        }
      } catch {}
    }

    throw new Error('ComfyUI generation timed out');
  }

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'comfyui',
      name: this.name,
      supportedStyles: [
        'natural',
        'fantasy',
        'realistic',
        'anime',
        'digital-art',
        'photographic',
        '3d-render',
        'pixel-art',
        'oil-painting',
        'watercolor',
      ],
      supportedSizes: ['512x512', '1024x1024', '1024x1792', '1792x1024', '2048x2048'],
      supportsNegativePrompt: this.supportsNegativePrompt,
      supportsCustomDimensions: this.supportsCustomDimensions,
      supportsSeed: true,
      supportsSteps: true,
      maxResolution: this.maxResolution,
      avgGenerationTime: 20000,
    };
  }

  registerWorkflow(name: string, workflow: ComfyUIWorkflow): void {
    this.workflowTemplates.set(name, workflow);
  }

  getWorkflow(name: string): ComfyUIWorkflow | undefined {
    return this.workflowTemplates.get(name);
  }
}

export const createImageProvider = (
  provider: 'dalle' | 'stable-diffusion' | 'comfyui',
  options?: { apiKey?: string; baseUrl?: string },
): ImageGenerationProviderInterface => {
  switch (provider) {
    case 'dalle':
      return new DallEProvider(options?.apiKey);
    case 'stable-diffusion':
      return new StableDiffusionProvider(options?.baseUrl);
    case 'comfyui':
      return new ComfyUIProvider(options?.baseUrl);
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
};
