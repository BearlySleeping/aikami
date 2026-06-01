import type {
  CallableFunction,
  CallableFunctionRequest,
  CallableFunctionResponse,
} from '@aikami/types';
import { BaseClass, type BaseClassInterface } from '@aikami/utils';
import type { HttpsCallable, HttpsCallableOptions } from 'firebase/functions';

type Functions = typeof import('@aikami/frontend/configs/functions.ts');

export type FirebaseFunctionsServiceInterface = {
  /**
   * Typed wrapper for callable functions registered in CallableFunctions.
   * Provides full type safety for request/response types.
   */
  call<T extends CallableFunction>(
    name: T,
    payload: CallableFunctionRequest<T>,
  ): Promise<CallableFunctionResponse<T>>;
} & BaseClassInterface;

class FirebaseFunctionsService extends BaseClass implements FirebaseFunctionsServiceInterface {
  private static _functions?: Functions;

  async call<T extends CallableFunction>(
    name: T,
    payload: CallableFunctionRequest<T>,
  ): Promise<CallableFunctionResponse<T>> {
    const callable = await this._getHttpsCallable(name);
    const { data } = await callable(payload);
    return data;
  }

  private async _getHttpsCallable<T extends CallableFunction>(
    name: T,
    options?: HttpsCallableOptions,
  ): Promise<HttpsCallable<CallableFunctionRequest<T>, CallableFunctionResponse<T>>> {
    const { functions, httpsCallable } = await this.getFunctions();

    return httpsCallable<CallableFunctionRequest<T>, CallableFunctionResponse<T>>(
      functions,
      name as string,
      options,
    );
  }
  private async getFunctions(): Promise<Functions> {
    if (FirebaseFunctionsService._functions) {
      return FirebaseFunctionsService._functions;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FirebaseFunctionsService._functions = await import('@aikami/frontend/configs/functions.ts');
    return FirebaseFunctionsService._functions;
  }
}

export const firebaseFunctionsService: FirebaseFunctionsServiceInterface =
  new FirebaseFunctionsService({
    className: 'FirebaseFunctionsService',
  });
