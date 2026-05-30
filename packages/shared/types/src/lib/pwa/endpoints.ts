import type { AIMessageData, AIMessageResponse } from './endpoint_ai.ts';
import type { AuthMessageData, AuthMessageResponse } from './endpoint_auth.ts';

export type PWACallEndpoint = keyof PWACalls;

export type PWACallRequest<T extends PWACallEndpoint = PWACallEndpoint> = PWACalls[T][0];

export type PWACallResponse<T extends PWACallEndpoint = PWACallEndpoint> = PWACalls[T][1];

export type PWACalls = {
  ai: [AIMessageData, AIMessageResponse];
  auth: [AuthMessageData, AuthMessageResponse];
  'auth/get-token': [
    undefined,
    {
      firebaseSignInToken: string;
    },
  ];
  'auth/session': [{ token?: string }, undefined];
};
