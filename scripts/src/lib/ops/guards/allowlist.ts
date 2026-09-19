// scripts/src/lib/ops/guards/allowlist.ts
//
// The dynamic-import allowlist, shared by `guard-mvvm-conventions` (M9) and
// `guard-service-conventions` (S12).
//
// Both guards police the same rule — "`await import()` is only valid for the
// specifiers documented in svelte-conventions/SKILL.md" — and both used to
// implement it with an array of unanchored regular expressions:
//
//   /@aikami\/frontend\/engine/   matched  @aikami/frontend/engine-evil
//   /eruda/                       matched  evil-eruda-wrapper
//   /onnxruntime-web/             matched  not-onnxruntime-web-at-all
//
// A regex that is not anchored at both ends turns an allowlist into a substring
// test, and an allowlist that can be satisfied by a substring is not an
// allowlist — it is a naming convention an agent can satisfy by renaming a
// dependency.
//
// So an entry is now one of three precise shapes, and matching is exact:
//
//   package  `onnxruntime-web`   matches `onnxruntime-web` and
//                                `onnxruntime-web/wasm` — never
//                                `onnxruntime-web-extras`
//   scope    `@tauri-apps`       matches `@tauri-apps/api` — never
//                                `@tauri-apps-evil/api`
//   query    `worker&type=module` matches `./x.ts?worker&type=module` — the
//                                marker must be introduced by `?` or `&`, so it
//                                cannot be a substring of a longer word
//
// 🔴 Adding an entry is a policy decision: it widens what the guard accepts. It
// belongs in the same review as a baseline change, and the SKILL's dynamic
// import table is the human-readable half of this list.
//
// Pure module: no filesystem, no process.

export type AllowlistEntry =
  | { kind: 'package'; name: string }
  | { kind: 'scope'; name: string }
  | { kind: 'query'; marker: string };

/** Shorthand constructors, so the lists below read as data. */
export const packageEntry = (name: string): AllowlistEntry => ({ kind: 'package', name });
export const scopeEntry = (name: string): AllowlistEntry => ({ kind: 'scope', name });
export const queryEntry = (marker: string): AllowlistEntry => ({ kind: 'query', marker });

/**
 * The specifier without its query/hash, which is what a package match compares.
 * `pixi.js?raw` and `pixi.js` are the same package.
 */
export const modulePathOf = (specifier: string): string => specifier.split(/[?#]/)[0] ?? '';

/** The `?…` part of a specifier, without the leading `?`. Empty when absent. */
export const queryOf = (specifier: string): string => {
  const index = specifier.indexOf('?');
  return index === -1 ? '' : specifier.slice(index + 1);
};

/**
 * True when a specifier names exactly this package, or an explicit subpath of
 * it. Never true for a package whose name merely starts with it.
 */
export const isPackageOrSubpath = (specifier: string, name: string): boolean => {
  const path = modulePathOf(specifier);
  return path === name || path.startsWith(`${name}/`);
};

/** True when a specifier is inside exactly this scope (`@scope` or `@scope/x`). */
export const isWithinScope = (specifier: string, name: string): boolean => {
  const path = modulePathOf(specifier);
  return path === name || path.startsWith(`${name}/`);
};

/**
 * True when the specifier's query contains this marker as a whole parameter
 * group, introduced by `?` or `&`.
 */
export const hasQueryMarker = (specifier: string, marker: string): boolean => {
  const query = queryOf(specifier);
  if (query.length === 0) {
    return false;
  }
  return new RegExp(`(^|[&])${escapeRegExp(marker)}(&|$)`).test(query);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when a specifier satisfies one allowlist entry. */
export const matchesEntry = (specifier: string, entry: AllowlistEntry): boolean => {
  if (entry.kind === 'package') {
    return isPackageOrSubpath(specifier, entry.name);
  }
  if (entry.kind === 'scope') {
    return isWithinScope(specifier, entry.name);
  }
  return hasQueryMarker(specifier, entry.marker);
};

/** True when a specifier satisfies any allowlist entry. */
export const isAllowlistedSpecifier = (
  specifier: string,
  entries: readonly AllowlistEntry[],
): boolean => {
  if (specifier.length === 0) {
    // A non-literal `import(someExpression)` cannot be checked statically, and
    // it is NOT allowlisted — an unverifiable import is not an accepted one.
    return false;
  }
  return entries.some((entry) => matchesEntry(specifier, entry));
};

/**
 * Entries both conventions guards share: heavyweight browser-only dependencies
 * that must be fetched on demand rather than pulled into a static graph, and
 * the Tauri/bundler specifier forms.
 */
export const SHARED_ALLOWLIST: readonly AllowlistEntry[] = [
  packageEntry('@aikami/frontend/engine'),
  packageEntry('onnxruntime-web'),
  packageEntry('kokoro-js'),
  packageEntry('pixi.js'),
  scopeEntry('@tauri-apps'),
  queryEntry('worker&type=module'),
  packageEntry('eruda'),
];

/**
 * ViewModel-only addition.
 *
 * `@aikami/frontend-preview` is the package the hub is meant to import from,
 * and its MapPreview/WalkSandbox entrypoints pull the engine (and therefore
 * PixiJS) transitively: the engine root barrel value-imports `pixi.js` through
 * `pixi_app.ts` and `game_world.ts`. Importing it statically would put PixiJS in
 * the hub's Cloudflare Worker server bundle, which `server_bundle_purity.test.ts`
 * exists to prevent.
 */
export const VIEW_MODEL_ALLOWLIST: readonly AllowlistEntry[] = [
  ...SHARED_ALLOWLIST,
  packageEntry('@aikami/frontend-preview'),
];
