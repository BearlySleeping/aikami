# AI setup and settings — execution plan

Status: planning approved; new contracts are **draft**, not execution-approved.
Created: 2026-09-05. Research baseline: `3bb9af3b` plus 25 dirty/untracked paths; recheck before work.
This pack does not authorize commits, PR creation, merges, deployment, or paid product inference.

## Start here

1. Run **[P00: baseline](packets/00_baseline.md)** with DeepSeek V4 Flash; it is read-only.
2. Resolve which existing local changes belong in the approved baseline. Do not stash/commit them automatically.
3. Review the four contracts below; explicitly approve before feature implementation.
4. Dispatch **[P01: desktop gating](packets/01_desktop_gating.md)**, then **[P02: local verification](packets/02_local_verification.md)**.
5. After those two pilot PRs land, inspect cost/retries/review quality before increasing concurrency.
6. Follow the dependency order in [queue.md](queue.md), not contract number order alone.

Run one packet per agent session: read [dispatch.md](dispatch.md) and the selected packet, implement only that packet, then stop at the handoff.
Do **not** run a whole `bun run contract C-481` as the first step: a contract contains multiple review-sized slices, and the pipeline may advance to PR/review automatically.

## Product decisions carried forward

- Setup happens on first app launch, not inside the OS installer; no sign-in or cloud boot dependency.
- Welcome offers Recommended setup, Connect something I already use, and a text-only shortcut.
- Text is required for AI gameplay, not for opening settings or exploring the app shell.
- Images and read-aloud are optional; an optional installation failure must not prevent text-ready play.
- Per-capability choices may mix online providers, existing local/LAN services, and supported managed runtimes.
- Discover only after a clear user action; offer reuse before downloading; never adopt or modify an external installation silently.
- Native/Docker installation controls are hidden on web, but supported browser inference and reachable server connections remain available.
- Existing credentials/endpoints/models are reusable in both settings and onboarding; these surfaces share operations, not a giant settings ViewModel.
- Recommended means compatible and resource-aware, not the largest downloadable model or a paid provider chosen without consent.
- No silent local-to-cloud fallback. Keys, model downloads, paid tests, and privacy changes need explicit consent.
- A no-key/no-download hosted trial is **excluded**, not rejected permanently; it needs a separately approved funding/security design.

## Current delivery versus future capability support

| Capability | This delivery |
|---|---|
| Story/dialogue (`text`) | Required; online, existing server, managed native text |
| Artwork (`image`) | Online/existing supported image engines; existing Docker CLI provisioning retained |
| Read aloud (`voice`, UI says read-aloud/TTS) | Online/existing server and current supported local/browser TTS |
| Speech recognition (`stt`) | Preserve existing backend/schema work; no new onboarding activation |
| Music generation | Reserved design case, not an enabled feature |
| Sound effects / ambience generation | Separate reserved design case; not TTS or volume settings |
| Video generation | Reserved design case, not an enabled feature |

Music, ambience, STT and video need typed capability-specific adapters/configuration later. Long-running jobs must not assume every request is streamed text.
Dynamic music cues, looping/mixing, microphone UX and video playback are separate future features, not hidden scope in this refactor.
New managed image engines or in-app Docker management are **not promised** here; unavailable install paths must be absent, not nonfunctional buttons.

## Durable specifications

| Contract | Weight | New guarantee / existing work reused |
|---|---|---|
| [C-481](../../contracts/C-481-ai-configuration-convergence.md) | Full | Canonical configuration/routing, identity and compatibility; follows C-463/C-465 |
| [C-482](../../contracts/C-482-managed-ai-runtime-lifecycle.md) | Full | Shared catalog/planning, durable jobs, safe native lifecycle; follows C-389/C-391/C-467 |
| [C-483](../../contracts/C-483-guided-ai-setup.md) | Thin | Guided setup using C-481/C-482 operations; follows C-466 |
| [C-484](../../contracts/C-484-capability-first-settings.md) | Thin | Searchable task-first settings using the same operations; follows C-465/C-466 |

Old contracts remain historical specifications. Do not mark them superseded/completed or rewrite their execution reports to hide discovered failures.
The queue's repair packets restore existing promises; the new contracts specify changed guarantees. A slice landing does not complete its parent contract.

## Model allocation

| Job | Model / account | Limit |
|---|---|---|
| Baseline, repair packets, bounded implementation, tests, ordinary fixes | `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high` | Default worker; two failed attempts on the same issue then escalate |
| C-481 architecture/migration critique | Strong OpenAI reasoning model through the funded API account | One focused review; no invented model slug |
| C-482 download/IPC/ownership critique | Claude Opus through a confirmed Pro-authenticated Claude Code session | One independent review; API billing is not Pro allowance |
| Migration, packaged-runtime and final integration checkpoints | OpenAI **or** Claude, chosen by remaining budget and risk | Not both on every PR |
| PR diff review | CodeRabbit | One newly submitted review-ready PR per hour |

Actual pipeline defaults live in `scripts/src/lib/agents/contract_pipeline/models.ts`: both `pro` and `flash` currently resolve to DeepSeek V4 Flash. Role names do not imply independent models.
Resolve and record the effective model, provider, thinking and billing account before execution; environment overrides may change defaults. No routing settings are changed by this plan.
Keep an initial **$10–15 premium review/escalation envelope** as a proposed cap, confirm before spending, then reassess after P01/P02. This is not a total-cost estimate or spend authorization.
Existing C-473/C-480 usage/evaluation work is reusable if available, but completing that separate program is not a prerequisite; manual cost records suffice.

## Completion and review

Use [queue.md](queue.md) for order/file ownership and [dispatch.md](dispatch.md) for review gates and the launch prompt.
Success means tested production journeys and packaged desktop restart/recovery, not only green mocks or completed screens.
Planning files and application changes must remain separate review scopes. Each file in this initial pack is under 100 lines; later reports must also respect the PR diff gate or request an exception.
Generated contract dashboards and `INDEX.md` were not edited; sync only through existing tooling when the approved planning changes are published.
