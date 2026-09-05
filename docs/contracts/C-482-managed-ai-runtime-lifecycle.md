---
id: C-482
title: "Unify managed AI provisioning, model assets and runtime lifecycle"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---
# Contract C-482: Unify managed AI provisioning, model assets and runtime lifecycle

## Metadata
| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); follow-up to C-389/C-391/C-467 |
| **Target** | `packages/shared/local-ai`, shared catalog/schema, frontend local-runtime, client AI services/Tauri, local-stack catalog consumers |
| **Type** | full |
| **Priority** | P0 — make installation and restart trustworthy |
| **Dependencies** | Existing C-389/C-390/C-391/C-467; C-481 P05 seam before R02, P08 before R05; R01 can start independently |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | Desktop/local AI setup guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence
`src-tauri/src/lib.rs` refuses redirects, while HEAD checks of all three catalog text URLs returned 302 on 2026-09-05. The wizard constructs Hugging Face URLs itself; Rust embeds another app's manifest. Current catalog/local asset representations overlap.
`sidecar_service.svelte.ts` uses port 11434 and curl probes; shell permissions also pin that port. Existing Ollama may conflict. Start is tied to wizard installation; cancellation changes UI tokens without cancelling the Rust transfer.
`packages/shared/local-ai/src/lib/recommend.ts` uses Docker/GPU passthrough to choose a backend, yet the desktop wizard promises no Docker. Model byte size is not a complete runtime memory budget.
Baseline: current local-ai planner, model asset store, sidecar/wizard tests, native tests and local-stack tests. Test the actual packaged engine, not `src-tauri/binaries` development stand-ins.

## User Outcome
A desktop player reuses an existing service or explicitly installs supported local AI, can cancel/retry safely, and can reopen the app offline without repeating setup or damaging another application's installation.

## Existing System & Reuse Map
| Source | Treatment |
|---|---|
| `packages/shared/local-ai` detection/planning and injected ProbeExecutor | Reuse hardware facts; separate model fit from runtime-specific prerequisites |
| `apps/backend/local-stack/stack/models.manifest.json` and local model asset catalogs | One shared, validated artifact authority with consumer adapters, not app-to-app imports |
| `packages/frontend/local-runtime` and client voice model service | Reuse download/storage seams and supported browser/local TTS; no separate voice wizard engine |
| Client sidecar/wizard services and Tauri commands | Move durable work/lifecycle to services/native host, leave UI presentation thin |
| `apps/backend/local-stack/install.sh` and CLI | Retain CLI/server path and compatibility; do not execute shell installer from desktop wizard |

## Architecture Directives
Freeze catalog/planning/job interfaces with C-481 P05. Keep catalog data/schema under shared packages; CLI, browser storage and Tauri consume compatible projections. Use runtime-configured artifact origins and pinned revisions/checksums, not duplicated URL templates.
Discovery is explicit, bounded and additive: cloud configuration does not suppress local candidates. Probe known endpoints without scanning the filesystem/network broadly; distinguish installed, running, model-present and compatible. Never auto-adopt a discovered process.
Native planning uses available signed engine builds/actual accelerators, not Docker readiness. Include context/KV/runtime overhead, companion artifacts, disk/temp headroom and concurrent workloads. If fit is uncertain, warn or offer a smaller supported model; never unconditionally claim comfortable fit.
Ship managed native text and the current supported local/browser TTS path. Existing supported image servers/online providers and Docker CLI remain usable. New image sidecars, automatic Docker installation and future modalities are outside this contract.
Native commands validate catalog artifact IDs, paths, ownership and operation arguments; do not widen shell/HTTP permissions to arbitrary commands or URLs just to support dynamic ports.

## State & Data Models
A versioned installation inventory records runtime/build, owned assets, selected model, storage location and ownership. It is separate from the encrypted provider vault; C-481 stores only runtime references. Imported/detected installations default to external.
A versioned setup job records requested capability, approved plan/artifacts, dependencies, progress, cancellation and recoverable failure. Stages are planned/downloading/verifying/starting/testing/ready, with cancelled/failed alternatives. No keys or signed transient URLs are persisted.
Process health is observed ephemeral state, never inferred from an inventory record. A ready installation may be stopped; generation starts the owned engine on demand. Long-running artifact jobs are not modeled as streamed text responses.

## Quality Requirements
Security: validate every redirect hop against trusted HTTPS destinations, reject downgrade/unexpected ports/private destinations and cap hops; never forward credentials cross-origin. Test hostile URLs, encoded traversal and symlink escape. Fixtures may use an explicitly isolated test transport, not relaxed production policy.
Downloads: size/hash verification, atomic promotion, bounded concurrency/deadlines, disk-space checks, real cancellation, and resumable transfer where the server supports validated Range/ETag; otherwise clearly restart safely. Retain verified assets on failure.
Processes: allocate/retry ports with ownership checks; detect bind races and actual child exit; never treat arbitrary successful `/health` as the requested owned model. Track/terminate only owned processes, including abnormal quit cleanup where supported.
Privacy/offline: no silent installs or cloud fallback. Explain model licenses, size, destination and runtime prerequisites before work. Resource limits prevent optional image/download work starving required text. Accessibility is handled by consuming UI contracts.

## Migration & Rollback
Validate/version local inventory and job journals; reconcile them with actual files/processes after restart. Adopt legacy files only after verification; never infer external process ownership from localhost or provider ID. Idempotent migration preserves artifacts and old encrypted config.
Write inventory/journal changes atomically, retain recoverable previous metadata, and preserve external files/CLI `.env`/model volumes. Schema failure disables managed actions with repair guidance, not destructive cleanup. Rolling back UI must not delete assets or strand owned processes.
Catalog relocation must keep CLI bundle contents and existing target paths compatible; test generated/shared projections. Do not silently rewrite a user's `.env` or change published installer/release URLs. Broader CLI updater redesign requires its own follow-up packet/specification.

## Scope Boundaries
In: reviewed shared catalog/planning, native text/current local TTS provisioning, lifecycle/inventory/jobs, discovery and canonical registration; CLI catalog compatibility. Out: hosted trial, new runtime engines, in-app Docker management, global GPU scheduler, OS driver installation, new speech/music/ambience/video implementations.

## Contract Size & Split Rule
Queue R01–R05 plus T01; these are multiple PRs. Keep old production mounts working during the service transition. See [split rules](SHARED_SECTIONS.md#contract-size--split-rule).

## Acceptance Criteria
| AC | Given / When / Then | Required evidence |
|---|---|---|
| AC-1 | Given a valid catalog CDN redirect and malicious alternatives, when downloading, then the valid asset verifies and unsafe hops/paths/size/hash fail without replacing good data. | Injected HTTP/native integration matrix; metadata-only live redirect check optional |
| AC-2 | Given native hardware without Docker, when planning, then native support/fit is independent of container availability and accurate warnings/licenses/total bytes are shown. | Planner fixtures: CPU, supported GPUs, insufficient disk/memory, companion files |
| AC-3 | Given an approved job, when cancelled, interrupted or retried after restart, then underlying work stops/reconciles and good assets remain reusable without duplicate writes. | Transport/journal integration tests; cancellation during download/verify/start; Range restart cases |
| AC-4 | Given occupied ports or an external healthy server, when starting/stopping Aikami, then it only controls its own process and verifies the requested model. | Native port-conflict/bind-race/crash/quit tests; external process remains alive |
| AC-5 | Given an installed owned engine, when reopening offline and generating, then it starts on demand and canonical registration remains stable without rerunning the wizard. | Packaged native text install -> quit -> offline reopen -> generation |
| AC-6 | Given cloud config and a compatible existing local server, when explicitly scanning, then reuse is offered without mutation; browser unsupported actions never execute native IPC. | Discovery mixed-source/permission/timeout tests; browser production-route E2E |
| AC-7 | Given text plus optional image/voice work, when optional setup fails or resources are tight, then text-ready play remains available and optional work is bounded/recoverable. | Job dependency/resource fixtures; mixed-provider production journey |
| AC-8 | Given shared catalog updates and an existing CLI installation, when built/loaded, then native/browser/CLI consumers agree on artifact identity and existing `.env`/target paths remain compatible. | Catalog/schema/CLI fixtures and bundle inspection; no cross-app source import |

## Implementation Sequence
Follow queue dependencies. Use registered `local-ai:test`, `local-runtime:test`, `client:test` and affected CLI/schema tests after confirming actual task IDs in P00; native finite commands via `bg`, then affected `validate({ test: true })`. T01 requires real packaged native evidence for each platform advertised as supported; unavailable hardware remains unverified.

## Edge Cases & Gotchas
No manifest -> actionable failure, not empty successful plan. Registry/model IDs are not filesystem paths. Cancelling near registration must not persist a ready connection to a stopped/unverified runtime. Do not test only against development mocks.

## Open Questions
None delegated. Exact signed-build availability is verified against release configuration before approving the advertised support matrix; do not invent GPU/platform support. Material security or schema changes require amendment.

## Amendments
No amendments; draft specification. Scope/AC changes require version bump and user approval.

## Promotion Lifecycle
See [shared promotion rules](SHARED_SECTIONS.md#promotion-lifecycle).
## Status Lifecycle
See [shared status rules](SHARED_SECTIONS.md#status-lifecycle). Append an execution report only after implementation; missing packaged evidence prevents verification.
