// apps/frontend/pwa/src/lib/views/dev/text/text_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type TextViewModelInterface = BaseViewModelInterface;

export type TextViewModelOptions = BaseViewModelOptions & {};

class TextViewModel extends BaseViewModel<TextViewModelOptions> implements TextViewModelInterface {}

export const getTextViewModel = (options: TextViewModelOptions): TextViewModelInterface =>
  new TextViewModel(options);
