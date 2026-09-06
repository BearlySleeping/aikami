# AI setup and settings — execution plan

Status: **four approved contracts, four PRs.** C-481, C-482, C-483 and C-484 are all approved and
runnable with `bun run contract C-xxx`.
Created: 2026-09-05. Re-merged 2026-09-06. Research baseline: `3bb9af3b`; source review at `acb7a18e`.
Recheck every baseline premise against current `main` before each run.

## Start here

Run the contracts in order, one at a time, each producing one PR:

```bash
bun run contract C-481   # configuration, migration, setup operations, routing
bun run contract C-482   # downloads, catalog, jobs, owned runtime lifecycle
bun run contract C-483   # guided setup: subflows, first-run routes, optional modalities
bun run contract C-484   # capability-first settings + programme close-out
```

Each contract depends on the previous one being **merged on `main`** — not merely written in another
worktree. Run `bun contract` from `main`, not from a feature-branch worktree.

The earlier packet-based execution (P00–P05) and the C-485…C-501 split are **withdrawn**. Their
scope lives inside the four contracts above; their concrete baseline evidence was folded into the
contracts' *Problem & Baseline Evidence* sections. Do not reintroduce a packet layer.

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

Music, ambience, STT and video need typed capability-specific adapters and configuration later.
Long-running jobs must not assume every request is streamed text. Dynamic music cues, looping and
mixing, microphone UX and video playback are separate future features, not hidden scope here.
New managed image engines and in-app Docker management are **not promised**; unavailable install
paths must be absent, not nonfunctional buttons.

## The four contracts

| Contract | Delivers | Phases inside the one PR |
|---|---|---|
| [C-481](../../contracts/C-481-ai-configuration-convergence.md) | Canonical configuration, routing, identity, migration and shared setup operations | seam freeze → projection repair → v3 writes + migration → setup operations → canonical resolution |
| [C-482](../../contracts/C-482-managed-ai-runtime-lifecycle.md) | Trustworthy downloads, one artifact catalog, durable jobs, owned process lifecycle | redirect integrity → host gating → catalog + planning → durable jobs → lifecycle → provision + text slice |
| [C-483](../../contracts/C-483-guided-ai-setup.md) | Reusable setup subflows and the guided first-run journey | subflows → guided routes → optional modalities |
| [C-484](../../contracts/C-484-capability-first-settings.md) | Task-first settings, capability pages, local resources, and programme close-out | navigation → capability pages + connections → local resources + privacy → acceptance matrix, shim removal, docs |

Old contracts remain historical specifications. Do not mark them superseded or completed, and do not
rewrite execution reports to hide discovered failures.

## PR size

Each contract is **one PR**, target ~50 changed files including tests, hard stop at 100.
Every contract carries its own size gate and an ordered phase list. If a run reaches the cap, it
stops at the last complete phase, leaves no two live write paths, and reports the remainder as an
explicit follow-up — it does not silently narrow an acceptance criterion.

## Model allocation

Every stage of every contract runs on `deepinfra/deepseek-ai/DeepSeek-V4-Flash` with thinking `high`.
Pipeline defaults live in `scripts/src/lib/agents/contract_pipeline/models.ts`: both `pro` and `flash`
already resolve to DeepSeek V4 Flash, so role names do not imply independent models. Environment
overrides may change defaults — resolve and record the effective model, provider, thinking level and
billing account before execution.

Escalate to a premium model only after two failed attempts on the same issue, a security-invariant
change, or a necessary schema/API deviation. CodeRabbit still reviews each PR diff.

## Completion and review

Success means tested production journeys and packaged desktop restart/recovery, not green mocks or
completed screens. Planning files and application changes stay separate review scopes. Generated
contract dashboards (`PROGRESS.md`, `PROMOTION.md`, `INDEX.md`) are synced only through the existing
tooling, never edited by hand.
