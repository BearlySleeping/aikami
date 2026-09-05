---
id: C-482
title: "Unify managed AI provisioning, model assets and runtime lifecycle"
source: direct
contract_type: full
status: approved
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---
# Contract C-482: Unify managed AI provisioning, model assets and runtime lifecycle

## Metadata
| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); follow-up to C-389/C-390/C-391/C-467 |
| **Target** | `packages/shared/local-ai`, shared catalog/schema, `packages/frontend/local-runtime`, client AI services, `src-tauri` commands and capabilities, local-stack catalog consumers |
| **Type** | full |
| **Priority** | P0 — make installation and restart trustworthy |
| **Dependencies** | Implemented C-389/C-390/C-391/C-467; C-481 P05 seam before R02 and P08 before R05; R01 needs only queue P02 plus pilot acceptance, not the C-481 seam |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | Desktop/local AI setup guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.1.0 |

## Problem & Baseline Evidence
Initial research used `3bb9af3b`; source review at `acb7a18e` confirms the managed native path cannot complete a supported download. `download_model_file` builds a client with `redirect::Policy::none()` and treats any 3xx as failure, while HEAD checks of all three catalog text entries returned 302 to Hugging Face CDN hosts on 2026-09-05. The same command compares only scheme and host against `models.originUrl`, ignoring port and path, so origin validation is simultaneously too strict for real CDNs and looser than the stated policy.
Artifact identity is duplicated in four places: `local_ai_wizard_view_model.svelte.ts:476` and `model_asset_store.ts:69`/`:145` each build `https://huggingface.co/{repo}/resolve/{revision}/{file}` by hand, `write_default_config` hardcodes the origin allowlist, and `lib.rs` embeds another app's catalog through `include_str!("../../../../backend/local-stack/stack/models.manifest.json")`, rewriting it into app data on every launch. `ModelManifest.entries` and `LocalModelBundle`/`LocalModelAsset` describe overlapping assets with different fields, and the two transports diverge: the browser path follows redirects and buffers the whole asset in memory before hashing, the native path streams to a fixed `<file>.part` sibling with no resume and no per-job temp identity.
Ownership and lifecycle are inferred, not tracked. `sidecar_service.svelte.ts` health-checks `http://127.0.0.1:11434/health` through `curl` and, when anything answers, sets `status: 'running'` without owning that process; `stop()` then reports `not-installed`, conflating process state with installation state. `is_allowed_probe` hardcodes that exact curl invocation at `timeout_ms == 3000`, and `capabilities/default.json` pins `--port 11434` in `shell:allow-spawn` plus `http://localhost:11434/**` in `http:allow-fetch`, so a dynamic port needs a policy design, not a widened scope. An existing Ollama on 11434 is therefore adopted silently. Cleanup registers only `onCloseRequested`, and only after a successful start.
`cancelDownload()` increments `_installToken` and calls `sidecarService.stop()`; the Rust transfer has no cancellation token and runs to completion, so cancel changes UI tokens only. `recommend.ts` selects a backend from `profile.containerRuntime` and `profile.gpuPassthroughReady`, falling back to CPU when Docker does not report GPU support, yet the desktop wizard promises no Docker; fit is model bytes against 70% VRAM or 50% RAM, with no context/KV, companion-artifact or temp-space budget. `_registerLocalProvider()` writes `source: 'detected'` for an app-installed runtime and registers before any generation is proven.
Baseline: run the current local-ai planner, `model_asset_store`, sidecar/wizard, native and local-stack tests during P00 and record actual failures. Test the packaged engine; `src-tauri/binaries` contains `.sh` shims and `mock_llama_server_windows.go` development stand-ins. This approval is source review, not test or implementation verification.

## User Outcome
A desktop player reuses an existing service or explicitly installs supported local AI, can cancel and retry safely, and can reopen the app offline without repeating setup or damaging another application's installation.

## Success Measures
A supported catalog artifact downloads end to end through its real CDN redirect chain, verifies, and is never re-downloaded once verified. Cancellation stops the underlying transfer, not just the view. Offline reopen reaches a first generated token from an owned engine without network, sign-in or rerunning the wizard. An external server on a probed port is never started, stopped or claimed by Aikami. Optional image or read-aloud failure leaves text-ready play available.

## Existing System & Reuse Map
| Source | Treatment |
|---|---|
| `packages/shared/local-ai` detection/planning and injected `ProbeExecutor` | Reuse hardware facts and the seam; separate model fit from runtime-specific prerequisites, and native from container reasoning |
| `apps/backend/local-stack/stack/models.manifest.json` and `LocalModelBundle` asset catalogs | One shared, validated artifact authority with consumer projections; replace `include_str!` cross-app embedding with a built/packaged artifact |
| `packages/frontend/local-runtime` transports and client voice model service | Reuse download/storage/cache seams and supported browser/local TTS; converge verification and streaming behavior, no separate voice wizard engine |
| Client sidecar/wizard services and `src-tauri` commands | Move durable work, cancellation and lifecycle to services and the native host; leave UI presentation thin |
| `apps/backend/local-stack/install.sh` and CLI | Retain CLI/server path and compatibility; never execute the shell installer from the desktop wizard |

## Architecture Directives
Freeze catalog, planning and job interfaces with C-481 P05. Keep catalog data and schema under shared packages; CLI, browser storage and Tauri consume compatible projections of one artifact identity. One resolver derives an artifact's download URL, revision, checksum, size and target path — no view model, transport or Rust default may reconstruct it. Artifact origins are runtime-configured and pinned by revision and checksum.
Redirect handling is a reviewed policy, not a toggle. Follow redirects only through an explicit hop-by-hop validator that re-checks scheme, host, port and destination class against the approved origin/CDN policy, caps hop count, and drops credentials across origins. Verification stays anchored to the pinned checksum and size, so a permitted CDN hop cannot change what is installed.
Discovery is explicit, bounded and additive: cloud configuration does not suppress local candidates. Probe known endpoints without scanning the filesystem or network broadly, and distinguish installed, running, model-present and compatible. Never auto-adopt a discovered process; a reachable endpoint may become a suggested external connection, never an owned runtime.
Native planning uses available signed engine builds and actual accelerators, not container readiness or GPU passthrough. Budgets include context/KV and runtime overhead, companion artifacts, disk and temp headroom, and concurrent workloads. If fit is uncertain, warn or offer a smaller supported model; never unconditionally claim comfortable fit.
Ship managed native text and the current supported local/browser TTS path. Existing supported image servers, online providers and the Docker CLI remain usable. New image sidecars, automatic Docker installation and future modalities are out of scope. Native commands validate catalog artifact IDs, paths, ownership and operation arguments. If a dynamic port is adopted, it is expressed as a reviewed capability policy — a bounded port range and sidecar argument validator — not `shell`/`http` scopes widened to arbitrary commands or URLs; if that policy is not approved, keep a fixed owned port and resolve conflicts by failing visibly.

## State & Data Models
A versioned installation inventory records runtime and build identity, owned assets, selected model, storage location and ownership. It is separate from the encrypted provider vault; C-481 stores only runtime references. Imported or detected installations default to external, and an existing `source: 'detected'` row is never upgraded to owned without verified evidence.
A versioned setup job records requested capability, approved plan and artifacts, dependencies, progress, cancellation and recoverable failure. Stages are planned, downloading, verifying, starting, testing and ready, with cancelled and failed alternatives. Cancellation is a token that reaches the native transfer, not a UI-side epoch check. No keys or signed transient URLs are persisted.
Process health is observed ephemeral state, never inferred from an inventory record and never conflated with installation state. A ready installation may be stopped; generation starts the owned engine on demand. In-flight artifact work is identified per job so two jobs cannot share one temp path, and long-running artifact jobs are not modeled as streamed text responses.

## Quality Requirements
Security: validate every redirect hop against trusted HTTPS destinations, reject downgrade, unexpected ports and private or link-local destinations, and cap hops; never forward credentials cross-origin. Test hostile URLs, encoded traversal and symlink escape against the real path guard. Fixtures may use an explicitly isolated test transport, never relaxed production policy.
Downloads: verify size and checksum before promotion, promote atomically from a per-job temp name, bound concurrency and deadlines, check free space against total plan bytes plus temp headroom, and support real cancellation. Resume through validated `Range`/`ETag` where the server supports it; otherwise restart safely and say so. Do not require buffering an entire artifact in memory. Retain verified assets on failure and never let a partial transfer shadow a good file.
Processes: allocate and retry ports with ownership checks, detect bind races and actual child exit, and never treat an arbitrary successful `/health` as the requested owned model — confirm engine and model identity before reporting ready. Track and terminate only owned processes, including abnormal-quit cleanup where the platform supports it, and register cleanup before a child can outlive the app rather than after a successful start.
Privacy and offline: no silent installs and no cloud fallback. Explain model licenses, size, destination and runtime prerequisites before work, and honor `requiresAcknowledgement` entries. Resource limits prevent optional image or download work starving required text. Accessibility is owned by the consuming UI contracts.

## Migration & Rollback
Validate and version the local inventory and job journal, and reconcile them with actual files and processes after restart. Adopt legacy files only after checksum verification, so assets already at their `targetPath` under `$APPDATA/aikami-assets` are reused rather than re-downloaded. Never infer external process ownership from localhost or a provider ID. Migration is idempotent and preserves artifacts and old encrypted configuration.
Write inventory and journal changes atomically, retain recoverable previous metadata, and preserve external files, CLI `.env` and model volumes. Respect an existing user-edited `models.originUrl` instead of silently overwriting it, and stop unconditionally rewriting the bundled catalog into app data on every launch when a newer or user-managed copy is present. Schema failure disables managed actions with repair guidance, not destructive cleanup. Rolling back the UI must not delete assets or strand owned processes.
Catalog relocation must keep CLI bundle contents and existing target paths compatible; test generated and shared projections. Do not silently rewrite a user's `.env` or change published installer/release URLs. Broader CLI updater redesign requires its own follow-up packet and specification.

## Scope Boundaries
In: reviewed shared catalog and planning, native text and current local TTS provisioning, lifecycle, inventory and jobs, discovery and canonical registration, and CLI catalog compatibility. Out: hosted trial, new runtime engines, in-app Docker management, a global GPU scheduler, OS driver installation, and new speech, music, ambience or video implementations.

## Contract Size & Split Rule
Queue R01–R05 plus T01; these are multiple PRs. R01 may land the redirect/download policy before the catalog moves. Keep old production mounts working during the service transition, and never leave two live download or lifecycle paths at the end of a slice. See [split rules](SHARED_SECTIONS.md#contract-size--split-rule).

## Acceptance Criteria
| AC | Given / When / Then | Required evidence |
|---|---|---|
| AC-1 | Given a real catalog CDN redirect chain and hostile alternatives, when downloading, then the valid asset verifies and unsafe hops, ports, paths, sizes or hashes fail without replacing good data. | Injected HTTP plus native integration matrix: multi-hop CDN, downgrade, port/host change, private destination, hop cap, credential drop, traversal/symlink target; metadata-only live redirect check optional |
| AC-2 | Given native hardware without a container runtime, when planning, then native support and fit are independent of Docker and passthrough, and accurate warnings, licenses and total bytes are shown. | Planner fixtures: CPU-only, supported GPUs, no container runtime, insufficient disk/memory, context/KV overhead, companion files, acknowledgement-required entries |
| AC-3 | Given an approved job, when cancelled, interrupted or retried after restart, then the underlying native transfer stops and reconciles, and verified assets remain reusable without duplicate or colliding writes. | Transport/journal integration tests; cancellation during download, verify and start; concurrent same-artifact jobs; `Range` resume and restart-safe cases |
| AC-4 | Given an occupied port or an external healthy server, when starting or stopping Aikami, then it controls only its own process, verifies engine and model identity before ready, and the external process stays alive and unclaimed. | Native port-conflict, bind-race, crash and quit tests; foreign `/health` responder rejected; external process untouched after app quit |
| AC-5 | Given an installed owned engine, when reopening offline and generating, then it starts on demand and canonical registration remains stable without rerunning the wizard. | Packaged native text install → quit → offline reopen → generation, per advertised platform |
| AC-6 | Given cloud configuration and a compatible existing local server, when explicitly scanning, then reuse is offered without mutation and stays an external connection; browser-unsupported actions never execute native IPC. | Discovery mixed-source, permission and timeout tests; ownership never upgraded from detection; browser production-route E2E |
| AC-7 | Given text plus optional image or voice work, when optional setup fails or resources are tight, then text-ready play remains available and optional work is bounded and recoverable. | Job dependency and resource fixtures; mixed-provider production journey |
| AC-8 | Given shared catalog updates and an existing CLI installation, when built and loaded, then native, browser and CLI consumers agree on artifact identity, URLs derive from one resolver, and existing `.env` and target paths remain compatible. | Catalog/schema/CLI fixtures and bundle inspection; no hand-built artifact URL and no cross-app source import remain |

## Implementation Sequence
Follow queue dependencies: R01 download and redirect policy, R02 shared catalog and native planning, R03 durable jobs, R04 owned process lifecycle, R05 provisioning through canonical setup operations, then T01. Confirm task IDs in P00, then use registered `local-ai:test`, `frontend-local-runtime:test`, `client:test` and affected `local-stack`/`schemas` tests via Moon; run finite native commands via `bg`, then detect affected projects and run `validate({ test: true })`. T01 requires real packaged native evidence for each platform advertised as supported; unavailable hardware remains explicitly unverified rather than assumed.

## Edge Cases & Gotchas
No manifest means an actionable failure, not an empty successful plan. Registry and model IDs are not filesystem paths. A fixed `<file>.part` sibling collides across concurrent or retried jobs. Content-length may be absent, wrong or larger than the pinned size. Cancelling near registration must not persist a ready connection to a stopped or unverified runtime. An existing Ollama, LM Studio or previous Aikami sidecar may already hold the port. Do not test only against development mocks or the `src-tauri/binaries` shims.

## Open Questions
None delegated. Approval covers one artifact resolver, a validated-hop redirect policy, cancellable jobs with an inventory separate from the vault, and ownership that is recorded rather than inferred. The concrete hop/port policy and any dynamic-port capability change are reviewed in R01/R04 within those constraints. Signed-build availability is verified against release configuration before advertising a support matrix; do not invent GPU or platform support. Material security or schema changes require an amendment.

## Amendments
- **1.1.0 — review and approval:** At the user's request, verified the draft's claims against `acb7a18e` and tightened them with concrete anchors (`download_model_file` origin/redirect handling, four duplicated artifact-URL sites, the `include_str!` catalog embedding, `sidecar_service` port adoption, the hardcoded probe/capability port pins, non-cancelling `cancelDownload`, container-derived backend selection, `source: 'detected'` registration); added the missing Success Measures section; corrected the R01 dependency and the `frontend-local-runtime:test` task ID; specified per-job temp identity, resume, ownership recording, capability-policy limits and catalog/`originUrl` migration safety; sharpened AC-1/AC-3/AC-4/AC-8 evidence; set frontmatter and metadata to `approved`. Approval authorizes this specification, not implementation completion, commits, PRs or deployment. Future scope/AC changes require a version bump and user approval.

## Promotion Lifecycle
See [shared promotion rules](SHARED_SECTIONS.md#promotion-lifecycle).
## Status Lifecycle
See [shared status rules](SHARED_SECTIONS.md#status-lifecycle). Append an execution report only after implementation; missing packaged evidence prevents verification.
