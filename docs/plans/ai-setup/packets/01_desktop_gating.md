# P01 — keep native AI installation out of the browser

Model: `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`.
Dependencies: P00 baseline accepted; explicit packet dispatch. Restore C-467's desktop-only entry guarantee; do not implement draft parent contracts.
Read [dispatch rules](../dispatch.md). One isolated worktree, one complete review-sized behavior.
Parallelism: pilot is sequential; read-only C-481/C-482 critique may run alongside it.

## Baseline evidence

`apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` currently implements `showLocalAiWizard` from active text tab and missing text provider, without a desktop check.
`local_ai_wizard_view_model.svelte.ts` rejects browser installation only later inside `_downloadModel`. The UI can therefore offer an impossible action.
Confirm both premises against the approved baseline; if already fixed, prove the existing behavior and report no-op rather than manufacture a change.

## Allowed scope

- `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` and focused tests.
- `apps/frontend/client/src/lib/views/ai/local_ai_wizard_view_model.svelte.ts` only for early unsupported-host action guarding, plus focused tests.
- Existing capability E2E/POM or a focused new production-route spec for this behavior; no shared preload/POM edits without the integration owner's agreement.
- Read host detection utilities and the views. Modify view markup only if necessary to remove an unsupported action; all host logic stays outside the view.

## Acceptance

1. Without Tauri, a missing text connection never exposes the native hardware/install wizard.
2. Desktop retains the wizard for the same missing-text/text-tab case; having usable text still suppresses it.
3. Direct invocation of unsupported native actions returns a clear unavailable result without invoking probes, shell, filesystem or download IPC.
4. Browser online-provider, existing-server connection and supported local/browser voice setup remain available. Do not equate browser with cloud-only.
5. No network scan or native probe is introduced on mount, and the required-text gate is unchanged.

## Implementation constraints

Reuse an existing host check/helper where available; otherwise use a narrow guarded check at the existing ViewModel/action boundary. A centralized platform-capability architecture belongs to C-481, not this repair.
Do not add a new persistence field, runtime manager, capability registry, installer, dependency, or layout redesign.
Preserve current injection/testing seams; avoid static Tauri imports in browser code.

## Evidence

- Regression tests: browser/desktop x text missing/present x text/other tab; verify native executor calls stay zero on web.
- Production `/capability` browser E2E asserts native entry absent and supported provider setup still accessible.
- Follow P00's registered client/E2E task map; `moon_detect_affected` before validation and `validate({ test: true })` before handoff.
- Capture the changed production UI state as required by project verification; a mocked Tauri global alone is not packaged desktop evidence.
- Report per-file additions+deletions including new tests; target <=80, stop at >=100.

## Stop and handoff

Use the dispatch handoff format. Stop before commit/PR/merge and before P02.
If accomplishing the native action guard plus entry gate exceeds the file budget, propose two independently valid repair slices for approval; do not omit the unsupported-action test.
