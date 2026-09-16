# Aikami Documentation

Contributor and technical documentation for the Aikami monorepo — how to set it
up, how the current system works, which product decisions are authoritative, and
what work remains.

> **Player and content-creator instructions live elsewhere.** The Astro/Starlight
> site at [`apps/frontend/docs/src/content/docs/`](../apps/frontend/docs/src/content/docs/)
> is written for people *playing* Aikami and *authoring* content (running the
> game, connecting AI, authoring maps and packs, theming the HUD). This `docs/`
> tree is for people *building and running Aikami from source*. Contributor
> pages link out to the player site where a player-facing explanation is the
> right home; the two areas never duplicate the same instructions.

## Start here

| I want to… | Read |
|---|---|
| Set up my machine and run the game | [`intro/setup.md`](intro/setup.md) → [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Understand what Aikami is | [`intro/vision.md`](intro/vision.md) · [`intro/directives.md`](intro/directives.md) |
| Understand the current system | [`architecture/architecture.md`](architecture/architecture.md) |
| Find a day-to-day workflow | [`guides/`](guides/) |
| Look up a format, interface, or decision rationale | [`reference/`](reference/) |
| Read a product/UX spec | [`design/`](design/) |
| See what work is active or outstanding | [`plans/`](plans/) · [`TODO.md`](TODO.md) · [`contracts/PROGRESS.md`](contracts/PROGRESS.md) |
| Trace a `C-xxx` contract comment in the code | [`contracts/`](contracts/) |

## Structure

| Folder | What's inside |
|---|---|
| [`intro/`](intro/) | Project overview, vision, non-negotiable directives, setup, onboarding, deferred scope |
| [`architecture/`](architecture/) | Current system architecture, technical invariants, and active specifications (including `combat_2.md`) |
| [`guides/`](guides/) | Contributor workflows: development, testing, CI, database, contract pipeline, engine/UI lessons, troubleshooting |
| [`reference/`](reference/) | Precise formats, interfaces, and the rationale records behind current constraints |
| [`design/`](design/) | Current product/UX specifications and clearly labelled proposals |
| [`plans/`](plans/) | Active initiatives with genuinely unfinished work (and functional inputs such as asset briefs) |
| [`contracts/`](contracts/) | Feature specifications, lifecycle tooling, backlogs, and generated dashboards |
| [`verification/`](verification/) | Generated performance/regression evidence referenced by contracts |
| [`themes/`](themes/) | Functional theme examples consumed by the theme tooling and tests |
| [`TODO.md`](TODO.md) | The structured intake for outstanding, contract-sized work |

Only folders with a real consumer exist. Categories are not preserved for their
own sake; material is folded into the closest home and linked, never copied.

## For AI tools

1. Read [`.context/CONTEXT.md`](../.context/CONTEXT.md) — the two-page briefing.
2. Read [`.context/llms.txt`](../.context/llms.txt) — the generated file map.
3. Read `AGENTS.md`, then the two or three files most relevant to the task.

Both `.context/` files are generated; do not hand-edit them. See
[Maintaining the docs](#maintaining-the-docs).

## Maintaining the docs

Where new material belongs, how plans retire, and when a feature change must
update canonical documentation:

- **New contributor workflow or how-to** → `guides/`. **New precise format,
  interface, or config reference** → `reference/`. **New architecture claim or
  invariant** → `architecture/`. **New product/UX spec** → `design/`. **New
  player/creator instruction** → the Astro/Starlight app under
  `apps/frontend/docs/src/content/docs/`, not this tree.
- **Plans retire instead of accumulating.** A file in `plans/` is only for work
  that is genuinely unfinished. When its contracts ship, delete the plan (Git
  history is the archive) after folding any still-valid decision into
  `architecture/`, `reference/`, or `design/`. Plans must state status, the
  owning contract IDs/issues, remaining work, and completion conditions.
- **Outstanding work belongs in one place.** Add contract-sized seeds to
  `TODO.md` using the parser headings and field syntax in
  [`reference/backlog-format.md`](reference/backlog-format.md). Once a contract
  file exists, the contract — not the TODO entry — is the authority. Do not open
  a second backlog document.
- **Contracts are append-only history.** Update status, evidence, and links;
  never rewrite an execution report to imply success it did not have. See
  [`contracts/README.md`](contracts/README.md).
- **Regenerate before you commit** when docs, contracts, or `TODO.md` change:

  ```bash
  bun run knowledge:sync   # sync_contracts + generate_llms_txt
  bun run scripts -- generate_context
  ```

  Generated files: [`contracts/PROGRESS.md`](contracts/PROGRESS.md),
  [`contracts/PROMOTION.md`](contracts/PROMOTION.md), `.context/llms.txt`, and
  `.context/CONTEXT.md`. Never edit these by hand.
- **A feature change that alters a documented claim must update the canonical
  document in the same change** — the same rule the contract
  [Definition of Done](reference/definition-of-done.md) applies to user docs.
