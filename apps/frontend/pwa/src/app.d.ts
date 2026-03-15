/* eslint-disable @typescript-eslint/consistent-type-definitions */
/// <reference types="@sveltejs/kit" />

// See https://kit.svelte.dev/docs/types#the-app-namespace
// for information about these interfaces
// declare let { FirebaseOptions }: import('firebase').app;

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare namespace App {
  type Locales = import('@aikami/types').SupportedLocale;
  type UserSessionData = import('@aikami/types').UserSessionData;
  type DeviceData = import('@aikami/types').DeviceData;
  type ErrorType = import('@aikami/types').ErrorType;
  type RouteName = import('$router').RouteName;

  interface Locals {
    locale: Locales;
    device?: DeviceData;
    userSession?: UserSessionData;
    currentRoute?: RouteName;
  }

  interface Error {
    type: ErrorType;
    errorId?: string;
    details?: unknown;
  }
}
