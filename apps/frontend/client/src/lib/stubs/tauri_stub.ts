// apps/frontend/client/src/lib/stubs/tauri_stub.ts
//
// Tauri native module stub — resolves `@tauri-apps/*` imports in BROWSER
// builds, where the native modules must never be bundled.
//
// This module is a build-time alias target only (see the
// `/^@tauri-apps\/.*$/` alias in vite.config.ts). It applies whenever
// `AIKAMI_DESKTOP_BUILD !== 'true'`, so it must NEVER be used by a desktop
// bundle: a packaged Tauri app really does execute the guarded call sites,
// and destructuring `appDataDir` / `readTextFile` / `info` off a module with
// no named exports yields `undefined`, failing at runtime with
// `TypeError: x is not a function`.
//
// The named exports below are therefore traps, not a shim: every one of them
// throws a message naming the actual mistake, so a desktop build that lost
// its `AIKAMI_DESKTOP_BUILD` flag fails loudly at the call site instead of
// shipping a bundle whose Tauri integration is silently dead.
export default {};

/** Build-time trap — see the module comment. */
const trap = (name: string): never => {
  throw new Error(
    `[aikami] Tauri API "${name}" was called from a browser-stubbed module. ` +
      'This means a DESKTOP build was made without AIKAMI_DESKTOP_BUILD=true, ' +
      'so vite.config.ts aliased @tauri-apps/* to lib/stubs/tauri_stub.ts. ' +
      'Build the desktop bundle with `bun run build:tauri` (or set ' +
      'AIKAMI_DESKTOP_BUILD=true when invoking vite directly).',
  );
};

export const appDataDir = (): never => trap('appDataDir');
export const join = (): never => trap('join');
export const exists = (): never => trap('exists');
export const readTextFile = (): never => trap('readTextFile');
export const writeTextFile = (): never => trap('writeTextFile');
export const remove = (): never => trap('remove');
export const readDir = (): never => trap('readDir');
export const mkdir = (): never => trap('mkdir');
export const invoke = (): never => trap('invoke');
export const convertFileSrc = (): never => trap('convertFileSrc');
export const open = (): never => trap('open');
export const save = (): never => trap('save');
export const message = (): never => trap('message');
export const emit = (): never => trap('emit');
export const listen = (): never => trap('listen');
export const getCurrentWindow = (): never => trap('getCurrentWindow');
export const getCurrentWebviewWindow = (): never => trap('getCurrentWebviewWindow');
export const openUrl = (): never => trap('openUrl');
export const relaunch = (): never => trap('relaunch');
export const check = (): never => trap('check');
export const download = (): never => trap('download');
export const install = (): never => trap('install');
export const trace = (): never => trap('trace');
export const debug = (): never => trap('debug');
export const info = (): never => trap('info');
export const warn = (): never => trap('warn');
export const error = (): never => trap('error');
export const attachLogger = (): never => trap('attachLogger');
export const attachConsole = (): never => trap('attachConsole');
export const LogLevel = undefined;
export const Command = (): never => trap('Command');
