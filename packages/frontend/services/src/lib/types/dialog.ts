import type { Color } from '@aikami/frontend/utils'

export type AppLoadingData = {
  label?: string
}

export type SnackbarType = 'success' | 'error' | 'warning' | 'info'

export type SnackbarData = {
  text: string
  type?: SnackbarType
}

export type ConditionalSnackbarData = {
  successText: string
  errorText: string
  responseOk: boolean
}

export type ResolveDialogData = {
  resolve?: (value: boolean) => void
}

export type ConfirmDialogData = ResolveDialogData & {
  title: string
  message: string
  agreeLabel?: string
  agreeColor?: Color
  disagreeLabel?: string
  imageName?: string
  minWidth?: number | string
  hideDisagreeButton?: boolean
}
