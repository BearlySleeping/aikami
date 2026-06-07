// apps/frontend/pwa/src/lib/views/dev/image/image_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type ImageViewModelInterface = BaseViewModelInterface;

export type ImageViewModelOptions = BaseViewModelOptions & {};

class ImageViewModel
  extends BaseViewModel<ImageViewModelOptions>
  implements ImageViewModelInterface {}

export const getImageViewModel = (options: ImageViewModelOptions): ImageViewModelInterface =>
  new ImageViewModel(options);
