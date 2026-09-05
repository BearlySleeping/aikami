# P02 — verify keyless local connections through their actual endpoint

Model: `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`.
Dependencies: P01 accepted on main; P00 baseline/task map refreshed. Restore C-465 testing behavior; no new persisted schema.
Read [dispatch rules](../dispatch.md). Run sequentially after P01 for the two-PR pilot.

## Baseline evidence

`apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.svelte.ts` `testConnection` returns `No endpoint or key` when a provider has no credential, including keyless local providers. It also derives a fixed verification URL rather than consistently honoring an instance endpoint.
Read provider definitions and existing gateway/probe utilities before adding another network implementation. Confirm the bug still exists on the current baseline.

## Allowed scope

- The AI settings ViewModel's connection-test delegation and focused tests.
- The smallest existing service/gateway verification helper that can own protocol-specific checks; add a focused helper/test only if no reusable seam exists.
- Provider metadata only where necessary to select an already-supported protocol probe; coordinate shared exports with the integration owner.
- Do not change settings layout/status badges, configuration migration, provider CRUD, installer, runtime lifecycle or model catalogs. Status presentation is P03.

## Acceptance

1. A configured keyless Ollama instance is tested at its configured base URL/path, not a hardcoded default; no API key is required.
2. A configured local OpenAI-compatible instance uses its supported read-only verification surface and validates the expected response shape, not merely HTTP 200.
3. Distinct instances with the same registry ID use their own URL and optional authentication; no request goes to another instance/provider by accident.
4. Connection refusal, malformed JSON/SPA HTML, timeout and browser network/permission failures return actionable results. Unsupported probe protocols report unsupported verification, not missing credentials.
5. Existing cloud-key validation remains intact. Test performs no paid generation, automatic installation, model download, or configuration mutation.
6. Requests have bounded timeouts/cancellation and duplicate/stale test responses cannot overwrite a newer result. Keys are never included in diagnostic output.

## Watch points

A local protocol may require authentication; keyless support must not strip a provided token. Cloud and arbitrary custom endpoints need different verification construction rules.
Do not mark model compatibility or successful generation from connectivity/model-list success. This packet checks connection reachability/authentication; final readiness belongs to C-481/C-482.
Use existing browser/native transport boundaries. Do not broaden Tauri HTTP/CSP permissions to unrestricted URLs, or promise the browser can bypass CORS/local-network permission policy.
Prefer injectable transport/probe functions. This should be reusable service logic, not more HTTP orchestration inside the large ViewModel.
If safely supporting the required protocols cannot fit the per-file gate, propose ordered complete slices before editing; do not silently narrow acceptance.

## Evidence

- Deterministic fixture tests: keyless Ollama, local compatible endpoint, two distinct bases, authenticated local, cloud regression, bad shape, refused/timeout/abort.
- Assert requested URL and headers without snapshotting real secrets. Use fixture credentials only.
- Confirm the existing settings Test action consumes the helper through the real ViewModel; do not mock the helper being proved.
- Run P00's current client/gateway test tasks and affected validation; no live paid API requests.
- Report changed-line totals, attempts and measured cost or unknown. Stop after two failed attempts at the same issue.

## Stop and handoff

Return acceptance evidence and the dispatch handoff; no automatic commit/PR/merge or P03 execution.
After P01 and P02 are reviewed, the human accepts or adjusts the model/budget/concurrency policy before opening the next implementation lane.
