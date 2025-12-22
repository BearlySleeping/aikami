import { BaseClass } from '@aikami/utils'
import type {
  BaseFrontendClassInterface,
  BaseFrontendClassOptions,
} from '../base/base-frontend-class.ts'
import type {
  AppLoadingData,
  ConditionalSnackbarData,
  ConfirmDialogData,
  SnackbarData,
} from '../types/dialog.ts'

export type DialogServiceOptions = BaseFrontendClassOptions

export type DialogServiceInterface = BaseFrontendClassInterface & {
  appLoading: AppLoadingData | undefined
  snackbar: SnackbarData | undefined
  confirmDialog: ConfirmDialogData | undefined

  showSnackbar(snackbar: SnackbarData): void
  showConditionalSnackbar(snackbar: ConditionalSnackbarData): void
  hideSnackbar(): void
  openConfirmDialog(
    confirmDialog: Omit<ConfirmDialogData, 'resolve'>,
  ): Promise<boolean>
  setAppLoading(loading: boolean, label?: string): void
}

export class DialogService extends BaseClass<DialogServiceOptions>
  implements DialogServiceInterface {
  snackbar = $state<SnackbarData | undefined>()
  confirmDialog = $state<ConfirmDialogData | undefined>()
  appLoading = $state<AppLoadingData | undefined>()

  async openConfirmDialog(
    confirmDialog: Omit<ConfirmDialogData, 'resolve'>,
  ): Promise<boolean> {
    this.log('openConfirmDialog', { confirmDialog })
    return await new Promise((resolve) => {
      this.confirmDialog = { ...confirmDialog, resolve }
    })
  }

  showSnackbar(snackbar: SnackbarData): void {
    this.log('showSnackbar', { snackbar })
    this.snackbar = {
      ...snackbar,
      type: snackbar.type ?? 'success',
    }
  }
  showConditionalSnackbar({
    errorText,
    responseOk,
    successText,
  }: ConditionalSnackbarData): void {
    this.showSnackbar({
      text: responseOk ? successText : errorText,
      type: responseOk ? 'success' : 'error',
    })
  }
  hideSnackbar(): void {
    this.log('hideSnackbar')
    this.snackbar = undefined
  }

  setAppLoading(loading: boolean, label?: string): void {
    this.log('setAppLoading', { label, loading })
    this.appLoading = loading ? { label } : undefined
  }
}

export const dialogService: DialogServiceInterface = new DialogService({
  className: 'DialogService',
})
