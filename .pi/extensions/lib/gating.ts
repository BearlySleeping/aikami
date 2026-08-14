// .pi/extensions/lib/gating.ts
//
// Conditional tool registration.
//
// 🔴 Every registered tool costs tokens on EVERY turn of EVERY session — its
// JSON Schema and description are pinned in the system prompt whether or not
// the session ever calls it. The cheapest tool is one that was never
// registered.
//
// Two mechanisms, in precedence order:
//
//   1. PI_TOOLS_OFF / PI_TOOLS_ON — comma-separated extension keys, letting a
//      session opt out of surface it knows it will not need.
//   2. A per-extension default predicate, e.g. "only in a pipeline worker".
//
// Gating is deliberately conservative: anything a normal session might reach
// for stays on by default. The only thing gated off by default is worker-side
// pipeline reporting, which is meaningless outside a pipeline worker.

/** Parses a comma/space separated env list into a lowercase set. */
const _envSet = (value: string | undefined): Set<string> =>
  new Set(
    (value ?? '')
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );

/** True when this pi process is an automated contract-pipeline worker. */
export const isPipelineWorker = (): boolean =>
  typeof process.env.CONTRACT_PIPELINE_ROLE === 'string' &&
  process.env.CONTRACT_PIPELINE_ROLE.length > 0;

/**
 * Decides whether an extension should register its tools.
 *
 * `PI_TOOLS_OFF=browser,firebase` force-disables; `PI_TOOLS_ON=contract_stage`
 * force-enables. An explicit ON beats an explicit OFF, so a pipeline runner
 * can always switch its own tools back on.
 */
export const isEnabled = (key: string, defaultEnabled = true): boolean => {
  const normalized = key.toLowerCase();
  if (_envSet(process.env.PI_TOOLS_ON).has(normalized)) {
    return true;
  }
  if (_envSet(process.env.PI_TOOLS_OFF).has(normalized)) {
    return false;
  }
  return defaultEnabled;
};
