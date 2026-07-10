// apps/frontend/client/src/lib/views/gallery/review_modal_view_model.svelte.ts
//
// ViewModel for the "review before generate" modal. Displays the compiled
// prompt (positive + negative), allows the user to edit both fields, and
// exposes confirm/cancel callbacks.
//
// Contract: C-242 Image Generation Pipeline

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type ReviewModalViewModelInterface = BaseViewModelInterface & {
  /** Whether the modal is currently open. */
  isOpen: boolean;
  /** The compiled positive prompt text (editable). */
  positivePrompt: string;
  /** The compiled negative prompt text (editable). */
  negativePrompt: string;
  /** Open the review modal with the given compiled prompt. */
  open(positive: string, negative: string): void;
  /** Close the modal without confirming. */
  cancel(): void;
  /**
   * Confirm the prompt and trigger generation.
   * Returns the (potentially edited) prompt.
   */
  confirm(): { positive: string; negative: string };
  /** Update the positive prompt text. */
  setPositivePrompt(value: string): void;
  /** Update the negative prompt text. */
  setNegativePrompt(value: string): void;
};

export type ReviewModalViewModelOptions = BaseViewModelOptions & {};

export class ReviewModalViewModel
  extends BaseViewModel<ReviewModalViewModelOptions>
  implements ReviewModalViewModelInterface
{
  isOpen = $state(false);
  positivePrompt = $state('');
  negativePrompt = $state('');

  open(positive: string, negative: string): void {
    this.positivePrompt = positive;
    this.negativePrompt = negative;
    this.isOpen = true;
  }

  cancel(): void {
    this.isOpen = false;
  }

  confirm(): { positive: string; negative: string } {
    const result = { positive: this.positivePrompt, negative: this.negativePrompt };
    this.isOpen = false;
    return result;
  }

  setPositivePrompt(value: string): void {
    this.positivePrompt = value;
  }

  setNegativePrompt(value: string): void {
    this.negativePrompt = value;
  }
}

export const getReviewModalViewModel = (
  options: ReviewModalViewModelOptions,
): ReviewModalViewModelInterface => ReviewModalViewModel.create(options);
