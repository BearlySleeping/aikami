// packages/frontend/services/src/lib/base/base-frontend-class.ts
import {
  BaseClass,
  type BaseClassInterface,
  type BaseClassOptions,
  toAppErrorFromUnknownError,
} from '@aikami/utils';
import { firebaseAnalyticService } from '../firebase/firebase_analytics_service.ts';
import { dialogService } from '../services/dialog.svelte.ts';
import type {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsEventParameters,
  ConditionalSnackbarData,
  ConfirmDialogData,
  SnackbarData,
} from '../types/index.ts';

export type BaseFrontendClassOptions = BaseClassOptions;

export type BaseFrontendClassInterface = BaseClassInterface;

export abstract class BaseFrontendClass<
    Options extends BaseFrontendClassOptions = BaseFrontendClassOptions,
  >
  extends BaseClass<Options>
  implements BaseFrontendClassInterface
{
  protected async logEvent<T extends AnalyticsEventName>(
    eventName: T,
    eventParameters: AnalyticsEventParameters<T>,
  ): Promise<void> {
    return await firebaseAnalyticService.logEvent(eventName, eventParameters);
  }

  protected showSnackbar(action: SnackbarData): void {
    return dialogService.showSnackbar(action);
  }
  protected showConditionalSnackbar(options: ConditionalSnackbarData): void {
    return dialogService.showConditionalSnackbar(options);
  }
  protected async openConfirmDialog(
    confirmDialog: Omit<ConfirmDialogData, 'resolve'>,
  ): Promise<boolean> {
    return await dialogService.openConfirmDialog(confirmDialog);
  }

  protected setAppLoading(loading: boolean, label?: string): void {
    return dialogService.setAppLoading(loading, label);
  }
  /**
   * A helper wrapper to handle service methods. It will show success/error
   * notifications and log the action.
   *
   * If successText is not provided, no notification will be shown on success.
   *
   * If errorText is not provided, no notification will be shown on error.
   *
   * If confirmArguments is provided, a confirmation dialog will be shown
   * before executing the service method.
   *
   * @param method The method to call
   * @param options The options on how to handle success/error of the method.
   */
  protected async callMethod(
    method: Promise<boolean> | (() => Promise<boolean>),
    options: {
      /**
       * This text will be shown as a success notification snackbar if the
       * method succeeds
       */
      successText?: string;
      /**
       * This text will be shown as a error notification snackbar if the
       * method fails
       */
      errorText?: string;
      /** The analytics event to send if the method succeeds */
      successAnalyticsEvent: AnalyticsEvent[];
      /**
       * The arguments to show a confirmation dialog, before executing the
       * {@link method}
       */
      confirmArguments?: Omit<ConfirmDialogData, 'resolve'>;
    },
  ): Promise<void> {
    const { confirmArguments, errorText, successText } = options;
    let { successAnalyticsEvent } = options;

    if (confirmArguments) {
      const confirmed = await this.openConfirmDialog(confirmArguments);
      if (!confirmed) {
        return;
      }
    }

    const responseOk = typeof method === 'function' ? await method() : await method;

    if (responseOk) {
      if (successText) {
        this.showSnackbar({
          text: successText,
          type: 'success',
        });
      }

      successAnalyticsEvent = Array.isArray(successAnalyticsEvent)
        ? successAnalyticsEvent
        : [successAnalyticsEvent];

      await Promise.all(
        successAnalyticsEvent.map((event) => this.logEvent(event.name, event.parameters)),
      );
    } else {
      // TODO: add analytic events for errors?
      // or use sentry?

      if (errorText) {
        this.showSnackbar({
          text: errorText,
          type: 'error',
        });
      }
    }
  }
  protected showErrorNotification(error: unknown, fallbackMessage?: string): void {
    const appError = toAppErrorFromUnknownError(error);

    const getText = (): string => {
      switch (appError.cause.errorType) {
        default:
          return fallbackMessage ?? 'unknown_error_occurred';
      }
    };

    this.showSnackbar({
      text: getText(),
      type: 'error',
    });
  }
}
