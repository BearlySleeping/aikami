// apps/frontend/client/scripts/service_worker_registration.ts
//
// Pure checks behind scripts/check_service_worker.ts. SvelteKit 3 always
// emits `build/service-worker.js` as an ES module (it prepends an import of
// `/_app/env.js`), so the manual registration in `src/app.html` must pass
// `{ type: 'module' }`. A classic registration of a module worker throws
// during script evaluation.

export type RegistrationType = 'classic' | 'module';

const REGISTER_CALL =
  /navigator\.serviceWorker\.register\(\s*['"]\/service-worker\.js['"]\s*(?:,\s*\{([^}]*)\})?\s*\)/;
const MODULE_TYPE = /\btype\s*:\s*['"]module['"]/;
const MODULE_SYNTAX = /^\s*(?:import\s*(?:[\w*{'"])|export\s)/m;

/** Registration type declared by the app shell, or undefined when it registers nothing. */
export const findRegistrationType = (html: string): RegistrationType | undefined => {
  const match = html.match(REGISTER_CALL);
  if (!match) {
    return undefined;
  }
  return MODULE_TYPE.test(match[1] ?? '') ? 'module' : 'classic';
};

/** Whether emitted worker code contains static ES module syntax. */
export const hasModuleSyntax = (code: string): boolean => MODULE_SYNTAX.test(code);

/** Returns a problem description, or undefined when registration and worker agree. */
export const checkServiceWorkerRegistration = (
  html: string,
  workerCode: string | undefined,
): string | undefined => {
  const registration = findRegistrationType(html);
  if (registration === undefined) {
    return workerCode === undefined
      ? undefined
      : 'build/service-worker.js was emitted but src/app.html never registers it';
  }
  if (workerCode === undefined) {
    return 'src/app.html registers /service-worker.js but the build emitted none';
  }
  if (registration === 'classic' && hasModuleSyntax(workerCode)) {
    return "build/service-worker.js uses ES module import/export but src/app.html registers it as a classic worker — add { type: 'module' }";
  }
  return undefined;
};
