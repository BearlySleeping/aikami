// apps/frontend/pwa/src/lib/views/dev/sandbox/sandbox_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type SandboxViewModelInterface = BaseViewModelInterface;

export type SandboxViewModelOptions = BaseViewModelOptions & {};

class SandboxViewModel
  extends BaseViewModel<SandboxViewModelOptions>
  implements SandboxViewModelInterface {}

export const getSandboxViewModel = (options: SandboxViewModelOptions): SandboxViewModelInterface =>
  new SandboxViewModel(options);
