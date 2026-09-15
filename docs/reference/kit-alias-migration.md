# Migration recipe: `#`-prefixed subpath imports

Reference material for the `kit.alias` → Node subpath-imports migration tracked
as **C-541** in [`../TODO.md`](../TODO.md). SvelteKit 3 (this repo is on
`@sveltejs/kit` `3.0.0-next.x`) prints, on every dev/build/preview run for both
apps:

> The `config.alias` option is deprecated ... Use subpath imports instead

`alias` still works today; it is only deprecated. The fix touches roughly 480
files in `client` and 60 in `hub`, which is why it is its own contract and not
bundled with other work.

## Why this is bigger than a find/replace

Node's `imports` field (the replacement mechanism) **requires every key to start
with `#`** — a hard Node spec rule, not a SvelteKit choice. The `$foo` aliases
map cleanly (`$lib` → `#lib`), but the `@aikami/frontend/theme`-style aliases are
a problem: those are **not** real npm/workspace package names (the real workspace
package is `@aikami/frontend-theme` with a dash, declared in
`dependencies`/`workspace:*` — the Vite alias fakes a slash-namespaced name that
bypasses the package's own `main`/`exports` and points straight at its `src/`,
presumably to skip a build step). `#`-prefixed subpath imports cannot preserve
that exact `@aikami/...` spelling.

## Decision required (blocking)

Pick one before any mechanical edit:

- **(a) minimal risk** — rename the `@aikami/*`-style aliases to `#`-prefixed
  names (e.g. `@aikami/frontend/theme` → `#aikami/frontend/theme`), keeping the
  same `src/`-pointing behavior. Loses the "looks like a real npm package"
  convention.
- **(b) correct but larger** — add real `"exports"` subpaths to each aliased
  package's `package.json` (e.g. `packages/frontend/theme`) and drop the Vite
  alias entirely, consuming as `@aikami/frontend-theme/...`.

## Alias inventory

The authoritative, current inventory is the `kit.alias` block in
[`apps/frontend/client/vite.config.ts`](../../apps/frontend/client/vite.config.ts)
and
[`apps/frontend/hub/vite.config.ts`](../../apps/frontend/hub/vite.config.ts).
Read it from there rather than trusting a copy — it changes. The two groups are:

- **`$`-style, local to the app** (safe to convert to `#`-prefixed subpath
  imports): `$appCss`, `$components`, `$i18n`, `$lib`, `$logger`, `$router`,
  `$routes`, `$services`, `$types`, `$utils`, `$views`; the hub additionally has
  `$loggerServer` and `$logger/*`.
- **`@aikami/*`-style** (needs the decision above).
- **Dead/broken lines to delete while in there:** the client's
  `@aikami/frontend/svelte-kit` + `@aikami/frontend-svelte-kit/*` aliases point
  at a nonexistent `packages/frontend/svelte-kit/src`; nothing in `client/src`
  imports either.

## Mechanical procedure (per app)

1. Add a package.json `imports` map for the app (client or hub), one entry per
   `#`-style alias, same target as the current `toSrcPath`/`toPackagesPath`
   value:
   ```json
   "imports": {
     "#lib": "./src/lib/index.ts",
     "#lib/*": "./src/lib/*",
     "#components/*": "./src/lib/components/*",
     "#services": "./src/lib/services/index.ts",
     "#services/*": "./src/lib/services/*"
   }
   ```
2. For each alias, from the app root, rewrite import specifiers with
   ripgrep + sed (dry-run with `rg` first, then apply):
   ```bash
   # dry run — see every hit before touching anything
   rg -n "from '\\\$services" src

   # apply (GNU sed, what this repo's Linux/Nix shell uses)
   rg -l "from '\\\$services/" src | xargs sed -i "s/from '\\\$services\\//from '#services\\//g"
   rg -l "from '\\\$services'" src | xargs sed -i "s/from '\\\$services'/from '#services'/g"
   ```
   Do the `/*`-suffixed (subpath) variant of each alias **before** the bare
   variant, since the bare pattern is a prefix of the subpath one and a careless
   single pass will double-rewrite (`#services` inside `#services/foo`). Also
   check dynamic `import('$services')` call sites and `vi.mock('$lib/...')` /
   `bun:test` mock paths in `*.test.ts`, which the `from '` search misses.
3. Repeat step 2 for every alias, app by app.
4. Delete the `alias: { ... }` block from both `vite.config.ts` files (including
   `toSrcPath`/`toPackagesPath` if nothing else uses them).
5. Run `moon check` (typecheck + lint) and `bun test` for both apps. TypeScript
   resolves `imports` subpaths automatically under
   `moduleResolution: "bundler"`, which this repo uses, but verify both
   `tsconfig.json` files afterward.
6. Update [`.pi/skills/svelte-conventions/SKILL.md`](../../.pi/skills/svelte-conventions/SKILL.md)
   (and anywhere else documenting the old convention) so future contracts do not
   regenerate the old aliases from muscle memory.
7. Build + preview both apps and confirm the deprecation warning is gone and
   nothing 404s.

## Related build-noise cleanup (fold into the same contract, or file separately)

- 7 `INEFFECTIVE_DYNAMIC_IMPORT` warnings (real, but pure bundle-splitting
  hygiene — modules are statically imported elsewhere too).
- `tsconfig.json` `"paths"` being overwritten during validation.
- An adapter warning that reading `config.kit` inside adapters is deprecated
  (should read `config` directly).
