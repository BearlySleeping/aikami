# Aikami — Pi AI Agent Setup

> Project-specific pi configuration: extensions, skills, custom tools, and development workflows.
> Global pi setup is documented at `~/.pi/README.md`.

---

## Relationship to ~/.pi

Aikami's `.pi/` directory extends the global `~/.pi/` setup with project-specific tooling:

| Layer                  | Location                             | Scope                                                                                  |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Global extensions      | `~/.pi/agent/extensions/`            | All projects (auto-fallback, git-checkpoint, log-offloader, model-modes, scroll-to-end) |
| Global skills          | `~/.pi/skills/`, `~/.agents/skills/` | All projects (browser-tools, find-skills)                                               |
| **Project extensions** | `.pi/extensions/`                    | Aikami only — see the inventory below                                                   |
| **Project skills**     | `.pi/skills/`                        | Aikami only — conventions, svelte, contracts, commands, pixi, tauri, backend            |

Models, observational memory, context-mode, theme, and Telegram bridge are global — configured in `~/.pi/`.

---

## 🔴 Tool surface is a per-turn tax

Every registered tool pins its name, description, `promptSnippet`, `promptGuidelines` and full
JSON Schema into the system prompt on **every turn of every session** — whether or not the session
ever calls it. This cost is invisible in normal use and only ever grows.

Measure it before adding tools:

```sh
bun run measure-tools                                    # normal session surface
CONTRACT_PIPELINE_ROLE=implementer bun run measure-tools # pipeline worker surface
```

Current: **23 registered tools, ~4.9k tokens** (24 / ~5.2k inside a pipeline worker).

Three rules keep it there:

1. **Namespace related tools.** A family of tools registers as ONE tool with an `action`
   discriminator — see `lib/tool_namespace.ts`. 26 `gh_*` tools became 5 namespaces.
2. **No `promptGuidelines`.** They are pure always-on cost and duplicate the description.
   `registration.test.ts` fails if any tool reintroduces them.
3. **`promptSnippet` only for default-reach tools** — currently `validate`, `moon_run_task`,
   `bg`, `poll_until`, `gh_pr`, `direnv`.

### Calling a namespaced tool

```jsonc
{ "action": "list", "params": { "state": "open", "limit": 20 } }
```

Each namespace's description carries a compact index of its actions and their parameters.
`params` is validated against that action's own TypeBox schema at dispatch, so a bad call gets a
precise error naming what was expected — the same feedback a standalone tool would have given.

### Turning surface off

`lib/gating.ts` reads two env lists. An explicit ON beats an explicit OFF.

```sh
PI_TOOLS_OFF=browser,firebase pi   # drop surface this session will not need
PI_TOOLS_ON=contract_stage pi      # force on something gated off by default
```

`contract_stage` is the only extension gated off by default — its actions need
`CONTRACT_PIPELINE_ROLE` and cannot be called correctly outside a pipeline worker.

---

## Extensions (`.pi/extensions/`)

### Running commands

| Tool         | Actions                             | Purpose                                                             |
| ------------ | ----------------------------------- | ------------------------------------------------------------------- |
| `bg`         | run, wait, status, list, kill       | Long commands in the background — builds, test suites, deploys      |
| `poll_until` | —                                   | Wait on **external** state with no exit event — health, CI, deploys |

**Which one?** If you launched the process, use `bg`: its completion signal is the exact exit
code. `poll_until` is inference, and only earns its keep when the thing being watched outlives the
command that inspects it. `bg` also learns how long a command usually takes (`lib/duration_cache.ts`)
and reports an ETA on repeat runs.

`poll_until` checks predicates in strict order — `failureRegex`, `successRegex`, `expectExitCode`,
then `stableFor`. That last one ("output stopped changing") is an opt-in heuristic of last resort:
a silent linking phase looks exactly like a finished build. Prefer an explicit regex whenever one
exists.

### Monorepo, environment, services

| Tool                                                                    | Purpose                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| `validate`                                                              | Fix+typecheck → optionally build+test          |
| `moon_run_task`, `moon_detect_affected`, `moon_list_projects`           | Monorepo task orchestration                    |
| `blackbox_test`                                                         | Full-stack blackbox integration tests          |
| `direnv` (status, switch_mode, add_package, add_secret)                 | Environment mode, Nix packages, secrets        |
| `gcloud_exec`                                                           | Authenticated gcloud invocation                |
| `service_logs`                                                          | Unified logs for Aikami services               |

### GitHub and review

| Tool          | Actions                                                          |
| ------------- | ---------------------------------------------------------------- |
| `gh_pr`       | create, list, view, status, merge, close, edit, ready, comments   |
| `gh_issue`    | list, create, close, reopen, edit, view                          |
| `gh_project`  | list, view, item_add, item_set, item_get                         |
| `gh_workflow` | run, status, logs, deploy                                        |
| `gh_release`  | list, view                                                       |
| `code_rabbit` | autofix, findings, wait                                          |

### Contracts and pipeline

| Tool             | Actions                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `contract`       | backlog, generate, workspace_create, workspace_checkpoint, workspace_complete, workspace_list |
| `contract_stage` | complete, review_decision, reconcile, log_failure — **worker-only, gated**                  |
| `herdr`, `task_pr`, `herdr_session` | herdr-native worktree and session orchestration                         |

### Browser and vision

| Tool                                   | Purpose                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `browser` (inspect, screenshot, console, network, lighthouse) | Headless Chromium against the Client dev server |
| `ai_describe_image`, `ai_validate_image`                      | VLM description and visual QA                   |

### Guards (no tools, no prompt cost)

These are the cheapest things here: event hooks that fix or block a known failure mode
deterministically, registering zero tools.

| Extension                   | What it does                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `bash_timeout_normalizer.ts` | Normalises ms→s timeouts, caps runaways, injects `CI=true` / `GIT_TERMINAL_PROMPT=0`          |
| `route_guard.ts`             | Fixes backslash-escaped SvelteKit route groups; blocks writes that would create `\(dev\)`     |
| `vision_guard.ts`            | Blocks image `read` on non-vision models; attaches or describes `browser screenshot` results  |
| `cost_guard.ts`              | Soft cap wraps the session up, hard cap shuts it down (`PI_SOFT_SPEND` / `PI_HARD_SPEND`)     |

---

## Shared libraries (`.pi/extensions/lib/`)

| Module               | Responsibility                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `process_runner.ts`  | **The** way to run a subprocess. `runCommand` (blocking) and `startCommand` (live handle)   |
| `gh.ts`              | **The** `gh` wrapper — `runGh`, `resolvePrSelector`, `tokenizeArgs`, `ensureGitHubRepo`      |
| `tool_namespace.ts`  | `registerNamespace` / `defineAction` — collapses a tool family into one registered tool      |
| `gating.ts`          | `isEnabled` / `isPipelineWorker` — conditional registration                                  |
| `output_normalize.ts`| ANSI stripping, `\r` redraw resolution, volatile-token scrubbing, fingerprinting             |
| `duration_cache.ts`  | Learned command durations, persisted to `.pi/cache/command_durations.json`                   |
| `async.ts`           | `abortableSleep`, `formatDuration`                                                            |
| `output_filter.ts`   | Moon JSON summarisation and smart truncation                                                 |

### Why durations and not a cached "done" regex

Caching a completion pattern memoises a heuristic on top of a heuristic. Output formats change
with every toolchain bump, and a stale pattern fails **silently in the worst direction** — calling
a still-running or broken build complete. A duration prior cannot do that: it only decides *when*
to look, never *whether* the thing finished. Its worst failure is polling slightly early.

---

## Conventions

| Convention                                                                                    | Enforced by                    |
| --------------------------------------------------------------------------------------------- | ------------------------------ |
| Run subprocesses via `lib/process_runner.ts`, never `pi.exec` or raw `child_process`          | `process_runner.ts`            |
| Call `gh` via `lib/gh.ts`, never a local wrapper                                              | `gh.ts`                        |
| Stream progress via `onUpdate` — **never `console.log`**, which corrupts pi's TUI             | `registration.test.ts` review  |
| Register a tool family as one namespace, not N tools                                          | `tool_namespace.ts`            |
| No `promptGuidelines` on any tool                                                             | `registration.test.ts`         |
| Always use `hypa_shell` / `hypa_read` / `hypa_grep` for shell and file ops                    | pi-hypa extension              |
| Always use `validate()` instead of raw moon commands                                          | `moon_integration.ts`          |
| Use `ctx_execute` for analysis; `ctx_fetch_and_index` for web docs                             | context-mode                   |
| Load `aikami-conventions` first before any code                                               | `dev.md` prompt 🔴             |
| Direnv environment is always loaded — extensions read `AIKAMI_MODE`, `AIKAMI_PROJECT_ID`      | `direnv.ts`                    |

### Extensions run inside the pi CLI process

Two consequences that bite every time they are forgotten:

- **No `Bun.*` APIs.** pi launches via its `#!/usr/bin/env node` shebang regardless of what is on
  PATH. `Bun.spawn` throws `Bun is not defined`, deterministically. Use `node:child_process`
  through `lib/process_runner.ts`.
- **stdout belongs to the TUI.** `console.log` from inside a tool `execute` paints over pi's
  render. Progress goes through the `onUpdate` callback.

---

## Testing

```sh
bun run test        # bun test extensions/
bun run typecheck   # tsgo --noEmit
bun run lint        # biome check .
bun run fix         # biome check --write
```

`extensions/lib/registration.test.ts` is the end-to-end guard: it loads every extension against a
stand-in pi API and asserts what registers — namespace action lists, no duplicate tool names, no
`promptGuidelines`. A truncated or mis-grouped extension shows up there as a missing action.

---

## Skills (`.pi/skills/`)

| Skill                  | When used                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `aikami-conventions`   | **🔴 LOAD FIRST** before ANY code — TS strictness, imports, arrow functions, `_` prefix, snake_case |
| `svelte-conventions`   | Svelte 5 runes, zero-logic Views, ViewModel pattern, services, client aliases                    |
| `backend-conventions`  | Cloudflare D1 (Drizzle) + R2 + Better Auth + Elysia route handlers, backend testing             |
| `aikami-ui`            | UI styling — DaisyUI primitives vs components, typography, semantic colors                       |
| `svelte-page`          | Scaffolding SvelteKit pages (View + ViewModel)                                                   |
| `new-project`          | Scaffolding new monorepo projects/packages                                                       |
| `contract-implementer` | Implementing features from `docs/contracts/`                                                     |
| `project-commands`     | Build, test, lint, deploy command reference                                                      |
| `pixijs-v8`            | PixiJS v8 + bitECS + engine boundary                                                             |
| `tauri-v2`             | Tauri v2 desktop app patterns                                                                    |

## Prompts (`.pi/prompts/`)

| Prompt                  | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `contract-implement.md` | Implementing feature contracts              |
| `dev.md`                | Development workflow and debugging protocol |
| `pre-commit.md`         | Pre-commit checklist                        |
| `handoff.md`            | Session handoff for $0 context spend        |
| `anti-loop.md`          | Anti-loop enforcement rules                 |
| `pi-test.md`            | Testing .pi changes                         |
