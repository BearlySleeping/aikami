import { BaseClass, type BaseClassInterface } from '@aikami/utils';
import type { HttpsCallable, HttpsCallableOptions } from 'firebase/functions';

type Functions = typeof import('./configs/functions.ts');

export type FirebaseFunctionsServiceInterface = {
  getHttpsCallable<RequestData = unknown, ResponseData = unknown>(
    name: string,
    options?: HttpsCallableOptions,
  ): Promise<HttpsCallable<RequestData, ResponseData>>;
} & BaseClassInterface;

class FirebaseFunctionsService extends BaseClass implements FirebaseFunctionsServiceInterface {
  private static _functions?: Functions;

  constructor() {
    super({
      className: 'FunctionsService',
    });
  }
  async getHttpsCallable<RequestData = unknown, ResponseData = unknown>(
    name: string,
    options?: HttpsCallableOptions,
  ): Promise<HttpsCallable<RequestData, ResponseData>> {
    const { functions, httpsCallable } = await this.getFunctions();

    return httpsCallable(functions, name, options);
  }
  private async getFunctions(): Promise<Functions> {
    if (FirebaseFunctionsService._functions) {
      return FirebaseFunctionsService._functions;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FirebaseFunctionsService._functions = await import('./configs/functions.ts');
    return FirebaseFunctionsService._functions;
  }
}

export const firebaseFunctionsService = new FirebaseFunctionsService();
