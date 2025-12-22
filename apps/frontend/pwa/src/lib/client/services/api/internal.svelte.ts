import type {
  AIMessageData,
  AIMessageResponse,
  AIMessageType,
  AuthMessageData,
  AuthMessageResponse,
  AuthMessageType,
  PWACallEndpoint,
  PWACallRequest,
  PWACallResponse,
  PWACalls,
} from '@aikami/types'

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services'
import { callSvelteKitAPI } from '@aikami/frontend/utils'
import { toAppErrorFromUnknownError } from '@aikami/utils'
import { authService } from './auth.svelte'

export type InternalAPIServiceOptions = BaseFrontendClassOptions

export type InternalAPIServiceInterface = BaseFrontendClassInterface & {
  /**
   * Calls the AI endpoint.
   * @param data The data to send to the AI endpoint.
   * @returns The response from the AI endpoint.
   */
  callAIEndpoint<T extends AIMessageType>(
    data: AIMessageData<T>,
  ): Promise<AIMessageResponse<T>>

  /**
   * Calls the auth endpoint.
   * @param data The data to send to the auth endpoint.
   * @returns The response from the auth endpoint.
   */
  callAuthEndpoint<T extends AuthMessageType>(
    data: AuthMessageData<T>,
  ): Promise<AuthMessageResponse<T>>

  /**
   * Sets the session token.
   * @param token The id token of the user
   */
  setToken(token?: string): Promise<void>
}

export class InternalAPIService extends BaseFrontendClass<InternalAPIServiceOptions>
  implements InternalAPIServiceInterface {
  async callAIEndpoint<T extends AIMessageType>(
    data: AIMessageData<T>,
  ): Promise<AIMessageResponse<T>> {
    return await this._callEndpoint('ai', data)
  }

  async callAuthEndpoint<T extends AuthMessageType>(
    data: AuthMessageData<T>,
  ): Promise<AuthMessageResponse<T>> {
    return await this._callEndpoint('auth', data)
  }

  async setToken(token?: string): Promise<void> {
    return await this._callEndpoint('auth/session', { token })
  }

  protected async _callEndpoint<Endpoint extends PWACallEndpoint>(
    endpoint: Endpoint,
    request: PWACallRequest<Endpoint>,
  ): Promise<PWACallResponse<Endpoint>> {
    this.log('_callEndpoint', { endpoint, request })
    try {
      return await callSvelteKitAPI<PWACalls, Endpoint>(
        endpoint,
        request,
        await this.getIdToken(),
      )
    } catch (error) {
      const appError = toAppErrorFromUnknownError(error)
      this.error('_callEndpoint', appError)

      // const errorType = appError.cause.errorType;
      // const captchaErrors: ErrorType[] = [
      // 	'captcha-invalid',
      // 	'captcha-required',
      // ];
      // if (captchaErrors.includes(errorType)) {
      // 	this._appService.setCaptchaFailedDialog(true);
      // }

      throw error
    }
  }
  protected async getIdToken(): Promise<string | undefined> {
    try {
      return await authService.getIdToken()
    } catch (error) {
      this.error('getIdToken', error)
      return
    }
  }
}

export const internalAPIService: InternalAPIServiceInterface = new InternalAPIService({
  className: 'InternalAPIService',
})
