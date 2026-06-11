// apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { type CheckpointInfo, imageGenerationService } from '$services';

export type { CheckpointInfo };

export type ImageViewModelInterface = BaseViewModelInterface & {
  /** The user-editable prompt sent to the image generation endpoint. */
  readonly prompt: string;
  /** URL of the generated image, or undefined. */
  readonly imageUrl: string | undefined;
  /** Whether an image generation is currently in progress. */
  readonly isGenerating: boolean;
  /** Available ComfyUI checkpoint models. */
  readonly checkpoints: readonly CheckpointInfo[];
  /** The currently selected checkpoint ID. */
  readonly selectedCheckpoint: string;
  /** Sends the prompt to the production image generation service. */
  generate(): Promise<void>;
  /** Resets state (generation is async and uncancellable in current impl). */
  cancel(): void;
};

export type ImageViewModelOptions = BaseViewModelOptions & {};

class ImageViewModel
  extends BaseViewModel<ImageViewModelOptions>
  implements ImageViewModelInterface
{
  prompt = $state('');
  imageUrl = $state<string | undefined>();
  isGenerating = $state(false);

  get checkpoints(): readonly CheckpointInfo[] {
    return imageGenerationService.checkpoints;
  }

  get selectedCheckpoint(): string {
    return imageGenerationService.selectedCheckpoint;
  }

  set selectedCheckpoint(value: string) {
    imageGenerationService.selectedCheckpoint = value;
  }

  // ── Public API ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await super.initialize();
    void imageGenerationService.loadCheckpoints();
  }

  async generate(): Promise<void> {
    if (!this.prompt.trim()) {
      return;
    }

    this.isGenerating = true;
    try {
      const result = await imageGenerationService.generateImage({ prompt: this.prompt });
      this.imageUrl = result.url;
    } finally {
      this.isGenerating = false;
    }
  }

  cancel(): void {
    this.isGenerating = false;
  }
}

export const getImageViewModel = (options: ImageViewModelOptions): ImageViewModelInterface =>
  new ImageViewModel(options);
