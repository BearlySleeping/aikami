import { z } from "zod";

export const ImageGenerationProviderSchema = z.enum([
	"dalle",
	"stable-diffusion",
	"comfyui",
]);
export type ImageGenerationProvider = z.infer<
	typeof ImageGenerationProviderSchema
>;

export const ImageSizeSchema = z.enum([
	"256x256",
	"512x512",
	"1024x1024",
	"1792x1024",
	"1024x1792",
]);
export type ImageSize = z.infer<typeof ImageSizeSchema>;

export const ImageStyleSchema = z.enum([
	"natural",
	"vivid",
	"fantasy",
	"realistic",
	"anime",
	"digital-art",
	"photographic",
	"3d-render",
	"pixel-art",
	"oil-painting",
	"watercolor",
]);
export type ImageStyle = z.infer<typeof ImageStyleSchema>;

export const ImageGenerationRequestSchema = z.object({
	prompt: z.string().describe("The prompt describing the image to generate"),
	negativePrompt: z
		.string()
		.optional()
		.describe("Things to avoid in the image"),
	provider: ImageGenerationProviderSchema.optional().describe(
		"Provider to use (auto-selects based on capability)",
	),
	size: ImageSizeSchema.optional().describe("Image dimensions"),
	style: ImageStyleSchema.optional().describe("Art style"),
	quality: z
		.enum(["standard", "hd", "ultra"])
		.optional()
		.describe("Generation quality"),
	seed: z.number().optional().describe("Seed for reproducible results"),
	steps: z
		.number()
		.min(1)
		.max(150)
		.optional()
		.describe("Number of diffusion steps"),
	cfgScale: z
		.number()
		.min(1)
		.max(20)
		.optional()
		.describe("CFG scale for diffusion"),
	width: z.number().optional().describe("Custom width"),
	height: z.number().optional().describe("Custom height"),
	sceneId: z.string().optional().describe("Scene ID for caching"),
	worldId: z.string().optional().describe("World ID for organization"),
});

export type ImageGenerationRequest = z.infer<
	typeof ImageGenerationRequestSchema
>;

export const ImageGenerationResultSchema = z.object({
	id: z.string().describe("Unique identifier for this generation"),
	imageUrl: z.string().describe("URL of the generated image"),
	thumbnailUrl: z.string().optional().describe("Thumbnail URL"),
	provider: ImageGenerationProviderSchema.describe("Provider used"),
	prompt: z.string().describe("Prompt used"),
	negativePrompt: z.string().optional(),
	seed: z.number().optional(),
	generationTime: z.number().describe("Time taken in milliseconds"),
	width: z.number(),
	height: z.number(),
	createdAt: z.string().datetime(),
});

export type ImageGenerationResult = z.infer<typeof ImageGenerationResultSchema>;

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

export const DEFAULT_IMAGE_SIZES: Record<
	ImageSize,
	{ width: number; height: number }
> = {
	"256x256": { width: 256, height: 256 },
	"512x512": { width: 512, height: 512 },
	"1024x1024": { width: 1024, height: 1024 },
	"1792x1024": { width: 1792, height: 1024 },
	"1024x1792": { width: 1024, height: 1792 },
};

export const STYLE_PRESETS: Record<ImageStyle, string> = {
	natural: "",
	vivid: "vibrant colors, high saturation",
	fantasy: "fantasy style, magical, whimsical",
	realistic: "photorealistic, realistic lighting, detailed",
	anime: "anime style, manga aesthetic",
	"digital-art": "digital art, concept art, detailed illustration",
	photographic: "professional photography, cinematic lighting",
	"3d-render": "3d render, cgi, blender, octane",
	"pixel-art": "pixel art, retro, 8-bit",
	"oil-painting": "oil painting, brushstrokes visible, classical",
	watercolor: "watercolor painting, soft colors, artistic",
};
