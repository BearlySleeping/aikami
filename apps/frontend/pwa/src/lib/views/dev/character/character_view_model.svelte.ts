// apps/frontend/pwa/src/lib/views/dev/character/character_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type CharacterViewModelInterface = BaseViewModelInterface;

export type CharacterViewModelOptions = BaseViewModelOptions & {};

class CharacterViewModel
  extends BaseViewModel<CharacterViewModelOptions>
  implements CharacterViewModelInterface {}

export const getCharacterViewModel = (
  options: CharacterViewModelOptions,
): CharacterViewModelInterface => new CharacterViewModel(options);
