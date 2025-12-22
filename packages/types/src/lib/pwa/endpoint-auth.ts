import type { RegisterForm } from '../form/auth.ts'

export type AuthApiEvents = {
  checkUniqueEmail: [
    {
      email: string
    },
    boolean,
  ]
  confirmTermsAndService: [
    {
      uid: string
    },
    string | void,
  ]
  createCustomFirebaseSignInToken: [
    undefined,
    {
      customFirebaseSignInToken: string
    },
  ]
  deleteAccount: [undefined, undefined]
  register: [
    {
      registerForm: RegisterForm
      shouldSendEmail?: boolean
      uid?: string
    },
    {
      /**
       * Creates a new Firebase custom token (JWT) that can be sent back
       * to a client device to use to sign in with the client SDKs'
       * signInWithCustomToken()
       */
      customFirebaseSignInToken: string
      uid: string
    },
  ]
  sendResetPassword: [
    {
      email: string
    },
    void,
  ]
  updateEmail: [
    {
      email: string
      uid: string
    },
    void,
  ]
}

export type AuthMessageData<T extends AuthMessageType = AuthMessageType> = {
  payload: AuthMessagePayload<T>
  type: T
}

export type AuthMessagePayload<T extends AuthMessageType = AuthMessageType> = AuthApiEvents[T][0]

export type AuthMessageResponse<T extends AuthMessageType = AuthMessageType> = AuthApiEvents[T][1]

export type AuthMessageType = keyof AuthApiEvents
