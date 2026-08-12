// apps/frontend/client/src/lib/views/utils/is_tauri.ts
//
// Single source of truth for the "running inside the Tauri webview vs a
// plain browser" check, shared by the auth service and the start / menu /
// login view models (previously each duplicated this one-liner).

/** Whether the current context is the Tauri webview. */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI__' in window;
