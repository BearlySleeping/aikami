// apps/backend/local-stack/src/index.ts
//
// Public entry point of @aikami/local-stack — the orchestration layer for
// the local AI engine stack (C-390). It owns the compose topology
// (compose*.yaml), the checksum-verified model fetcher, the `stack init`
// hardware-detection wizard, the native host launchers, and the one-command
// installer release bundle.
//
// Module layout (matches the repo convention):
//   src/lib/    runtime modules + their bun:test specs
//   src/scripts/  repo-local dev tools (Bun/TS, replacing the old .sh)
//   src/index.ts  this entry point
//
// The CLI entries (init, fetch, migrate) are not re-exported here — they
// run via `bun run src/lib/init.ts` etc. and gate on `import.meta.main`.

export { probeOllama } from './lib/detect_ollama.ts';
export type { CliOptions, RunInitDeps } from './lib/init.ts';
export {
  defaultEnvPath,
  defaultEnvPath as devDefaultEnvPath,
  parseArgs,
  renderPlan,
  runInit,
} from './lib/init.ts';
