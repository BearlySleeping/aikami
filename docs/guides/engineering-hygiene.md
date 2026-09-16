# Engineering Hygiene & Maintenance

> Ongoing codebase-health themes — not contracts. Only recurring themes are
> listed; concrete, contract-sized work belongs in [`../TODO.md`](../TODO.md).
> Reviewed 2026-09-16.

- **Import discipline.** Prefer the `#`-subpath and package-root imports
  described in [`CODING_STANDARDS.md`](CODING_STANDARDS.md). Static imports are
  the ordinary dependency default; use a dynamic `import()` only when it creates
  a real lazy boundary, and document why. Avoid reaching into another package's
  internals.
- **Type assertions.** Prefer type guards and schema validation over `as` casts.
- **JSDoc hygiene.** `@inheritdoc` is not needed; do not add it.
- **Engine base class.** Consider a `BaseClass` pattern with `Class.create()` for
  auto debug logging in `packages/frontend/engine/` (proposal, not a rule).
- **No hardcoded absolute paths.** Never commit paths referencing a contributor's
  machine.
- **`.pi` tooling.** Prefer Bun APIs (`Bun.file`, `Bun.spawn`) over Node
  equivalents in `.pi/` scripts. See the `.pi` ideas in
  [`../TODO.md`](../TODO.md#unscoped-ideas).
- **MCP configuration.** Evaluate whether internal MCP tools should replace
  direct tool calling (open question).
- **Skill size.** Keep `.pi/skills/aikami-conventions/SKILL.md` focused; split
  rather than grow without bound.
- **Service layer between ViewModels.** ViewModels that subscribe to other
  ViewModels' events should go through an intermediate service so ViewModels stay
  presentation-focused.

Resolved and removed from this list: direct `@aikami/frontend/configs/firestore.ts`
imports (Firestore removed, C-386), GCP Secret Manager/`secretspec` (replaced by
SOPS, C-441), and the Cloud Run creator-app sketch (superseded by the hub
studio, C-507/C-512).
