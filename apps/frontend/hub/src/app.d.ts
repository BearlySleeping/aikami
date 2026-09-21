/// <reference types="@sveltejs/kit" />

// See https://kit.svelte.dev/docs/types#the-app-namespace
// for information about these interfaces

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
    sessionId?: string;
  }

  interface Error {
    type?: ErrorType;
    message?: string;
    errorId?: string;
    details?: unknown;
  }

  interface PageData {
    sessionId?: string;
  }

  // C-426 AC-3: Cloudflare Worker bindings (D1 + R2).
  //
  // @sveltejs/adapter-cloudflare 8 (SvelteKit 3) no longer passes bindings to
  // `event.platform`; they are read from the `cloudflare:workers` module (see
  // src/lib/server/worker_env.ts). This interface doubles as the documentation
  // of the deployed bindings — keep it in sync with deployment_config.ts.
  interface Platform {
    env: CloudflareBindings;
  }
}

/**
 * The hub Worker's bindings. Declared on the global `Cloudflare` namespace so
 * the `cloudflare:workers` `env` export is typed, and referenced by
 * `App.Platform['env']` for any code that still receives a platform object
 * (unit tests inject it directly).
 */
interface CloudflareBindings {
  DB: import('@cloudflare/workers-types').D1Database;
  SAVES_BUCKET: import('@cloudflare/workers-types').R2Bucket;
  CATALOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
  // C-513: private intake plane for unreviewed community-asset bytes.
  // No public custom domain is ever attached to this bucket.
  UPLOADS_BUCKET: import('@cloudflare/workers-types').R2Bucket;
}

declare namespace Cloudflare {
  interface Env extends CloudflareBindings {}
}
