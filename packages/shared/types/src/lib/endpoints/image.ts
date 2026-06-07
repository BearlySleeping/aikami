// packages/shared/types/src/lib/endpoints/image.ts
// biome-ignore-all lint/style/useNamingConvention: Firestack derives Cloud Function names from file names, which must be snake_case.
// biome-ignore-all lint/style/useFilenamingConvention: Endpoint type file names match the callable function key, which follows Firestack convention.

/** A single node in a ComfyUI workflow graph. */
export type WorkflowNodeDef = {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
};

/** The full ComfyUI prompt payload sent to /prompt. */
export type ComfyUIPrompt = Record<string, WorkflowNodeDef>;

/** Options for generating an image via the image endpoint. */
export type GenerateImageOptions = {
  /** Base ComfyUI workflow definition (excluding output node). */
  workflow: Record<string, WorkflowNodeDef>;
  /** Positive prompt text for conditioning. */
  positivePrompt: string;
  /** Negative prompt text for conditioning. */
  negativePrompt?: string;
  /** Seed for deterministic generation (-1 for random). */
  seed?: number;
  /** Number of steps for the sampler. */
  steps?: number;
  /** CFG scale (classifier-free guidance). */
  cfg?: number;
  /** Width of the output image in pixels. */
  width?: number;
  /** Height of the output image in pixels. */
  height?: number;
};

/** Result of an image generation request. */
export type GenerateImageResult = {
  /** The raw PNG/JPEG image bytes. */
  imageData: Uint8Array;
  /** MIME type of the image data (e.g. 'image/png'). */
  mimeType: string;
  /** The prompt ID returned by ComfyUI. */
  promptId: string;
};

/** Events exposed through the image callable endpoint. */
export type ImageApiEvents = {
  generateImage: [GenerateImageOptions, GenerateImageResult];
  getQueueStatus: [Record<string, never>, { queueRemaining: number }];
};

export type ImageMessageType = keyof ImageApiEvents;
export type ImageMessageData<T extends ImageMessageType = ImageMessageType> = {
  payload: ImageApiEvents[T][0];
  type: T;
};
export type ImageMessagePayload<T extends ImageMessageType = ImageMessageType> =
  ImageApiEvents[T][0];
export type ImageMessageResponse<T extends ImageMessageType = ImageMessageType> =
  ImageApiEvents[T][1];
