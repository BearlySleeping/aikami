import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/index.ts';
import type { NpcData } from '@aikami/types/index.ts';
import { toAppErrorFromUnknownError } from '@aikami/utils/index.ts';
import { npcService } from '$services/index.ts';

export type NpcListViewModelOptions = BaseViewModelOptions;

export type NpcListViewModelInterface = BaseViewModelInterface & {
  readonly npcs: NpcData[];
  readonly isLoading: boolean;
};

class NpcListViewModel
  extends BaseViewModel<NpcListViewModelOptions>
  implements NpcListViewModelInterface
{
  npcs = $state<NpcData[]>([]);
  isLoading = $state<boolean>(false);

  override async initialize(): Promise<void> {
    this.setAppLoading(true);

    try {
      const npcs = await npcService.getAll();
      this.log('initialize', 'NPCs fetched successfully', npcs.length);
      this.npcs = npcs;
    } catch (error) {
      this.error('initialize', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    }

    this.setAppLoading(false);
    super.initialize();
  }
}

export const getNpcListViewModel = (options: NpcListViewModelOptions): NpcListViewModelInterface =>
  new NpcListViewModel(options);
