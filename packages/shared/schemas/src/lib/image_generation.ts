// packages/shared/schemas/src/lib/image_generation.ts
import Type from 'typebox';

export const ImageGenerationProviderSchema = Type.Union([
  Type.Literal('dalle'),
  Type.Literal('stable-diffusion'),
  Type.Literal('comfyui'),
]);
export type ImageGenerationProvider = Type.Static<typeof ImageGenerationProviderSchema>;

export const ImageSizeSchema = Type.Union([
  Type.Literal('256x256'),
  Type.Literal('512x512'),
  Type.Literal('1024x1024'),
  Type.Literal('1792x1024'),
  Type.Literal('1024x1792'),
]);
export type ImageSize = Type.Static<typeof ImageSizeSchema>;

export const ImageStyleSchema = Type.Union([
  Type.Literal('natural'),
  Type.Literal('vivid'),
  Type.Literal('fantasy'),
  Type.Literal('realistic'),
  Type.Literal('anime'),
  Type.Literal('digital-art'),
  Type.Literal('photographic'),
  Type.Literal('3d-render'),
  Type.Literal('pixel-art'),
  Type.Literal('oil-painting'),
  Type.Literal('watercolor'),
]);
export type ImageStyle = Type.Static<typeof ImageStyleSchema>;

export const ImageGenerationRequestSchema = Type.Object({
  prompt: Type.String({ description: 'The prompt describing the image to generate' }),
  negativePrompt: Type.Optional(Type.String({ description: 'Things to avoid in the image' })),
  provider: Type.Optional(ImageGenerationProviderSchema),
  size: Type.Optional(ImageSizeSchema),
  style: Type.Optional(ImageStyleSchema),
  quality: Type.Optional(
    Type.Union([Type.Literal('standard'), Type.Literal('hd'), Type.Literal('ultra')], {
      description: 'Generation quality',
    }),
  ),
  seed: Type.Optional(Type.Number({ description: 'Seed for reproducible results' })),
  steps: Type.Optional(
    Type.Number({ minimum: 1, maximum: 150, description: 'Number of diffusion steps' }),
  ),
  cfgScale: Type.Optional(
    Type.Number({ minimum: 1, maximum: 20, description: 'CFG scale for diffusion' }),
  ),
  width: Type.Optional(Type.Number({ description: 'Custom width' })),
  height: Type.Optional(Type.Number({ description: 'Custom height' })),
  sceneId: Type.Optional(Type.String({ description: 'Scene ID for caching' })),
  worldId: Type.Optional(Type.String({ description: 'World ID for organization' })),
});

export type ImageGenerationRequest = Type.Static<typeof ImageGenerationRequestSchema>;

export const ImageGenerationResultSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier for this generation' }),
  imageUrl: Type.String({ description: 'URL of the generated image' }),
  thumbnailUrl: Type.Optional(Type.String({ description: 'Thumbnail URL' })),
  provider: ImageGenerationProviderSchema,
  prompt: Type.String({ description: 'Prompt used' }),
  negativePrompt: Type.Optional(Type.String()),
  seed: Type.Optional(Type.Number()),
  generationTime: Type.Number({ description: 'Time taken in milliseconds' }),
  width: Type.Number(),
  height: Type.Number(),
  createdAt: Type.String({ format: 'date-time' }),
});

export type ImageGenerationResult = Type.Static<typeof ImageGenerationResultSchema>;

export interface ImageGenerationProviderInterface {
  readonly name: string;
  readonly provider: ImageGenerationProvider;
  readonly supportsStyles: boolean;
  readonly supportsNegativePrompt: boolean;
  readonly supportsCustomDimensions: boolean;
  readonly maxResolution: { width: number; height: number };

  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  getCapabilities(): ProviderCapabilities;
}

export interface ProviderCapabilities {
  provider: ImageGenerationProvider;
  name: string;
  supportedStyles: ImageStyle[];
  supportedSizes: ImageSize[];
  supportsNegativePrompt: boolean;
  supportsCustomDimensions: boolean;
  supportsSeed: boolean;
  supportsSteps: boolean;
  maxResolution: { width: number; height: number };
  avgGenerationTime: number;
}

export const DEFAULT_IMAGE_SIZES: Record<ImageSize, { width: number; height: number }> = {
  '256x256': { width: 256, height: 256 },
  '512x512': { width: 512, height: 512 },
  '1024x1024': { width: 1024, height: 1024 },
  '1792x1024': { width: 1792, height: 1024 },
  '1024x1792': { width: 1024, height: 1792 },
};

export const STYLE_PRESETS: Record<ImageStyle, string> = {
  natural: '',
  vivid: 'vibrant colors, high saturation',
  fantasy: 'fantasy style, magical, whimsical',
  realistic: 'photorealistic, realistic lighting, detailed',
  anime: 'anime style, manga aesthetic',
  'digital-art': 'digital art, concept art, detailed illustration',
  photographic: 'professional photography, cinematic lighting',
  '3d-render': '3d render, cgi, blender, octane',
  'pixel-art': 'pixel art, retro, 8-bit',
  'oil-painting': 'oil painting, brushstrokes visible, classical',
  watercolor: 'watercolor painting, soft colors, artistic',
};
