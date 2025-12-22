/// <reference types="@sveltejs/kit" />

// See https://kit.svelte.dev/docs/types#the-app-namespace
// for information about these interfaces
// declare let { FirebaseOptions }: import('firebase').app;

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare namespace App {
  type ErrorType = import('@shared/types').ErrorType

  interface Error {
    details?: unknown
    errorId?: string
    message?: string
    type: ErrorType
  }
}
