# P03 — replace inferred Running labels with honest connection status

Model: `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`.
Dependencies: P02 merged, pilot accepted and explicit dispatch.
Read [dispatch rules](../dispatch.md). May run beside P04 only with disjoint source/test ownership.

## Baseline evidence

`apps/frontend/client/src/lib/views/settings/ai/ai_settings_view.svelte` renders a Running badge whenever a provider-tree row is local. Locality says nothing about whether that process is running or its model can generate.
The ViewModel already exposes explicit test results. Reuse those results from P02; do not introduce periodic polling or another persisted health cache.

## Allowed scope

- AI settings view/provider row presentation and corresponding ViewModel presentation getters/tests.
- Focused settings POM/E2E assertions only; coordinate shared POM or preload edits.
- P04 owns config-service mutations and persistence tests. Do not edit its files or migrate canonical state here.

## Acceptance

1. A newly configured local provider with no successful check is labeled configured/not checked, never Running/Ready solely because it is local.
2. A successful P02 connection check may show reachable/last checked, but must not claim that every model under that provider is ready or generation-tested.
3. Failed/in-flight checks are visible with text as well as color. One failed connection must not incorrectly report unrelated sibling models as tested.
4. Changing the checked endpoint/credentials invalidates the displayed result; a removed/recreated connection must not inherit stale success.
5. No network request is triggered by mounting or opening settings. Cloud and local rows use the same status semantics.
6. Existing Test/Edit actions and provider/model labels remain usable; native process Running, once available, must come from runtime observations rather than this connectivity status.

## Watch points

Keep computed display labels and formatting in the ViewModel, not template expressions; use semantic theme tokens and accessible status text.
Do not replace one misleading badge with another global Connected claim. Connectivity, authentication, selected model, process lifecycle and generation are separate evidence levels.
No redesign of the whole provider tree or promotion of capability readiness logic; C-481 and later UI contracts own that work.
If result invalidation needs a small P02 helper extension, coordinate the owner and land that dependency first, not conflicting edits in two worktrees.

## Evidence

- ViewModel tests for untested, testing, reachable, failed, edited and deleted rows, including siblings on one provider.
- Production `/settings` E2E verifies no false Running badge and explicit test-result display; screenshot/visual evidence for changed states.
- Current registered client/E2E tasks plus affected validation, with exact baseline/new failures.
- Per-file diff totals including tests, target <=80; stop at >=100 or two failed repair attempts.

## Stop and handoff

Use the dispatch handoff format and release the AI-settings presentation file lock. Do not commit, publish or merge without instruction.
