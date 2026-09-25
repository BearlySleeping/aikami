# Coding Standards

The canonical coding standards live in the agent skills and in `biome.json`.
This page points at them instead of restating them — the previous restatement
of the Google TypeScript Style Guide contradicted the skills on arrow
functions, `type` vs `interface`, `null`, and the `_` private prefix, so it has
been removed.

## Source of truth by topic

| Topic | Read |
|---|---|
| Universal TS + monorepo conventions | `.pi/skills/aikami-conventions/SKILL.md` |
| Svelte 5 / SvelteKit / MVVM | `.pi/skills/svelte-conventions/SKILL.md` |
| Backend / D1 / Cloudflare | `.pi/skills/backend-conventions/SKILL.md` |
| UI, Tailwind, theme tokens | `.pi/skills/aikami-ui/SKILL.md` |
| Game engine (PixiJS v8 + bitECS) | `.pi/skills/pixijs-v8/SKILL.md` |
| Tauri desktop | `.pi/skills/tauri-v2/SKILL.md` |
| Testing | `.pi/skills/testing/SKILL.md` |
| Lint / format rules | `biome.json` — run `bun run lint` / `bun run fix` |

## Enforced mechanically by Biome

`any`, non-null assertions, `interface` for data shapes, file naming
(`snake_case`) and identifier naming (`camelCase`), and restricted imports fail
`biome check` directly. Run `bun run lint` before committing.

Structural guards enforce the architectural rules (MVVM boundaries, data plane,
test boundary, type-safety escapes, file size, cognitive complexity). Run them
fast with `bun run scripts/src/lib/ops/run_guards.ts`.

## Rules the skills carry (not lintable)

- Arrow functions everywhere; class methods use method syntax.
- Every private member takes a `_` prefix.
- `ClassName.create()` factory, never `new`; `create()` does the auto-logging.
- More than one argument becomes an options object.
- JSDoc every export; every source file opens with its repo-relative path.
- Errors use `toAppError` (`@aikami/utils`).
- Engine boundary: no `pixi.js` / `Application` / `app.ticker.add` outside
  `packages/frontend/engine/`.
- Client SPA: no `+server.ts` / `+page.server.ts` / `+layout.server.ts` under
  `apps/frontend/client/src/routes/`.

🔴 On a guard failure, fix the code — never raise a baseline, waiver or
ceiling. That is a human-reviewed policy change.
