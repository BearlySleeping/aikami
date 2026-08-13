// apps/frontend/hub/src/lib/views/dashboard/dashboard_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { authService } from '$services';

export type DashboardViewModelOptions = BaseViewModelOptions;

export type DashboardViewModelInterface = BaseViewModelInterface;

class DashboardViewModel
  extends BaseViewModel<DashboardViewModelOptions>
  implements DashboardViewModelInterface
{
  override async initialize(): Promise<void> {
    // Wait for Firebase Auth to resolve (IndexedDB restore on refresh).
    await authService.initialize();
    await super.initialize();
  }
}

export const getDashboardViewModel = (
  options: DashboardViewModelOptions,
): DashboardViewModelInterface => DashboardViewModel.create(options);
