import type { AIMessageData, AIMessageResponse } from './endpoint-ai.ts'
import type { AuthMessageData, AuthMessageResponse } from './endpoint-auth.ts'

export type PWACallEndpoint = keyof PWACalls

export type PWACallRequest<T extends PWACallEndpoint = PWACallEndpoint> = PWACalls[T][0]

export type PWACallResponse<T extends PWACallEndpoint = PWACallEndpoint> = PWACalls[T][1]

export type PWACalls = {
  ai: [AIMessageData, AIMessageResponse]
  auth: [AuthMessageData, AuthMessageResponse]
  'auth/get-token': [
    undefined,
    {
      firebaseSignInToken: string
    },
  ]
  'auth/session': [{ token?: string }, void]
}
