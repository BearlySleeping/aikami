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

> **Execution note (2026-09-06)**: this contract is executed as **one** unattended
> pipeline run (`bun run contract C-482`) producing **one PR**. The earlier split into
> C-489–C-494 is withdrawn; those files are deleted. Work the phases in the order given
> under *Implementation Phases* and keep the whole diff inside the PR-size gate.

## Metadata

| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); follow-up to C-389/C-390/C-391/C-467 |
| **Target** | `packages/shared/local-ai`, shared catalog/schema in `packages/shared/constants/`, `packages/frontend/local-runtime`, client AI/sidecar/wizard services, `apps/frontend/client/src-tauri/` commands and capabilities, local-stack catalog consumers |
| **Type** | full |
| **Priority** | P0 — make installation and restart trustworthy |
| **Dependencies** | Implemented C-389/C-390/C-391/C-467; **C-481 merged** (its frozen seams and canonical setup operations) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | Desktop/local AI setup guidance is updated by C-484, not here |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Initial research used `3bb9af3b`; source review at `acb7a18e` confirms the following. Re-confirm each premise against the current `main` before editing; if one is already fixed, prove the existing behavior and report a no-op.

- **Supported downloads cannot complete.** `download_model_file` builds a client with `redirect::Policy::none()` and treats any 3xx as failure, while HEAD checks of all three catalog text entries returned 302 to Hugging Face CDN hosts on 2026-09-05. The same command compares only scheme and host against `models.originUrl`, ignoring port and path — simultaneously too strict for real CDNs and looser than the stated policy.
- **Artifact identity is duplicated in four places.** `local_ai_wizard_view_model.svelte.ts:476` and `model_asset_store.ts:69`/`:145` each hand-build `https://huggingface.co/{repo}/resolve/{revision}/{file}`; `write_default_config` hardcodes the origin allowlist; and `lib.rs` embeds another app's catalog through `include_str!("../../../../backend/local-stack/stack/models.manifest.json")`, rewriting it into app data on every launch. `ModelManifest.entries` and `LocalModelBundle`/`LocalModelAsset` describe overlapping assets with different fields. The two transports diverge: the browser path follows redirects and buffers the whole asset in memory before hashing; the native path streams to a fixed `<file>.part` sibling with no resume and no per-job temp identity.
- **Ownership and lifecycle are inferred, not tracked.** `sidecar_service.svelte.ts` health-checks `http://127.0.0.1:11434/health` through `curl` and sets `status: 'running'` when anything answers, without owning that process; `stop()` then reports `not-installed`, conflating process state with installation state. `is_allowed_probe` hardcodes that exact curl invocation at `timeout_ms == 3000`, and `capabilities/default.json` pins `--port 11434` in `shell:allow-spawn` plus `http://localhost:11434/**` in `http:allow-fetch`, so a dynamic port needs a policy design, not a widened scope. An existing Ollama on 11434 is therefore adopted silently. Cleanup registers only `onCloseRequested`, and only after a successful start.
- **Cancellation is cosmetic.** `cancelDownload()` increments `_installToken` and calls `sidecarService.stop()`; the Rust transfer has no cancellation token and runs to completion.
- **Planning is container-derived.** `recommend.ts` selects a backend from `profile.containerRuntime` and `profile.gpuPassthroughReady`, falling back to CPU when Docker does not report GPU support, yet the desktop wizard promises no Docker. Fit is model bytes against 70% VRAM or 50% RAM, with no context/KV, companion-artifact or temp-space budget. `_registerLocalProvider()` writes `source: 'detected'` for an app-installed runtime and registers before any generation is proven.
- **Impossible actions are offered in the browser.** `capability_view_model.svelte.ts` derives `showLocalAiWizard` from the active text tab and a missing text provider without a desktop check; `local_ai_wizard_view_model.svelte.ts` rejects browser installation only later, inside `_downloadModel`.

**Baseline tests**: the current local-ai planner, `model_asset_store`, sidecar/wizard, native and local-stack tests. Run them first and record actual failures. Test the packaged engine — `src-tauri/binaries` contains `.sh` shims and `mock_llama_server_windows.go` development stand-ins.

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
| C-481 canonical setup operations and configuration | Register provisioned runtimes through them; never write a second configuration path |
| `apps/backend/local-stack/install.sh` and CLI | Retain CLI/server path and compatibility; never execute the shell installer from the desktop wizard |

## Architecture Directives

Keep catalog data and schema under shared packages; CLI, browser storage and Tauri consume compatible projections of one artifact identity. **One resolver** derives an artifact's download URL, revision, checksum, size and target path — no view model, transport or Rust default may reconstruct it. Artifact origins are runtime-configured and pinned by revision and checksum.

Redirect handling is a reviewed policy, not a toggle. Follow redirects only through an explicit hop-by-hop validator that re-checks scheme, host, port and destination class against the approved origin/CDN policy, caps hop count, and drops credentials across origins. Verification stays anchored to the pinned checksum and size, so a permitted CDN hop cannot change what is installed.

Discovery is explicit, bounded and additive: cloud configuration does not suppress local candidates. Probe known endpoints without scanning the filesystem or network broadly, and distinguish installed, running, model-present and compatible. Never auto-adopt a discovered process; a reachable endpoint may become a suggested external connection, never an owned runtime.

Native planning uses available signed engine builds and actual accelerators, not container readiness or GPU passthrough. Budgets include context/KV and runtime overhead, companion artifacts, disk and temp headroom, and concurrent workloads. If fit is uncertain, warn or offer a smaller supported model; never unconditionally claim comfortable fit.

Ship managed native text and the current supported local/browser TTS path. Existing supported image servers, online providers and the Docker CLI remain usable. New image sidecars, automatic Docker installation and future modalities are out of scope. Native commands validate catalog artifact IDs, paths, ownership and operation arguments. If a dynamic port is adopted, it is expressed as a reviewed capability policy — a bounded port range and a sidecar argument validator — not `shell`/`http` scopes widened to arbitrary commands or URLs; if that policy is not approved, keep a fixed owned port and resolve conflicts by failing visibly.

Host support is decided at the action boundary, outside views, reusing an existing host check where one exists. A browser must never be offered a native install or probe action, and must never be equated with cloud-only.

## State & Data Models

A versioned **installation inventory** records runtime and build identity, owned assets, selected model, storage location and ownership. It is separate from the encrypted provider vault; C-481 stores only runtime references. Imported or detected installations default to external, and an existing `source: 'detected'` row is never upgraded to owned without verified evidence.

A versioned **setup job** records requested capability, approved plan and artifacts, dependencies, progress, cancellation and recoverable failure. Stages are planned, downloading, verifying, starting, testing and ready, with cancelled and failed alternatives. Cancellation is a token that reaches the native transfer, not a UI-side epoch check. No keys or signed transient URLs are persisted.

Process health is observed ephemeral state, never inferred from an inventory record and never conflated with installation state. A ready installation may be stopped; generation starts the owned engine on demand. In-flight artifact work is identified per job so two jobs cannot share one temp path, and long-running artifact jobs are not modeled as streamed text responses.

## Quality Requirements

**Security.** Validate every redirect hop against trusted HTTPS destinations, reject downgrade, unexpected ports and private or link-local destinations, and cap hops; never forward credentials cross-origin. Test hostile URLs, encoded traversal and symlink escape against the real path guard. Fixtures may use an explicitly isolated test transport, never relaxed production policy.

**Downloads.** Verify size and checksum before promotion, promote atomically from a per-job temp name, bound concurrency and deadlines, check free space against total plan bytes plus temp headroom, and support real cancellation. Resume through validated `Range`/`ETag` where the server supports it; otherwise restart safely and say so. Do not require buffering an entire artifact in memory. Retain verified assets on failure and never let a partial transfer shadow a good file.

**Processes.** Allocate and retry ports with ownership checks, detect bind races and actual child exit, and never treat an arbitrary successful `/health` as the requested owned model — confirm engine and model identity before reporting ready. Track and terminate only owned processes, including abnormal-quit cleanup where the platform supports it, and register cleanup before a child can outlive the app rather than after a successful start.

**Privacy and offline.** No silent installs and no cloud fallback. Explain model licenses, size, destination and runtime prerequisites before work, and honor `requiresAcknowledgement` entries. Resource limits prevent optional image or download work starving required text. Accessibility is owned by the consuming UI contracts.

## Migration & Rollback

Validate and version the local inventory and job journal, and reconcile them with actual files and processes after restart. Adopt legacy files only after checksum verification, so assets already at their `targetPath` under `$APPDATA/aikami-assets` are reused rather than re-downloaded. Never infer external process ownership from localhost or a provider ID. Migration is idempotent and preserves artifacts and old encrypted configuration.

Write inventory and journal changes atomically, retain recoverable previous metadata, and preserve external files, CLI `.env` and model volumes. Respect an existing user-edited `models.originUrl` instead of silently overwriting it, and stop unconditionally rewriting the bundled catalog into app data on every launch when a newer or user-managed copy is present. Schema failure disables managed actions with repair guidance, not destructive cleanup. Rolling back the UI must not delete assets or strand owned processes.

Catalog relocation must keep CLI bundle contents and existing target paths compatible; test generated and shared projections. Do not silently rewrite a user's `.env` or change published installer or release URLs. Broader CLI updater redesign requires its own follow-up contract.

## Scope Boundaries

- **In scope:** the redirect and download integrity policy; one shared catalog and native-vs-container planning; durable cancellable jobs; owned process lifecycle and port handling; provisioning expressed through C-481's canonical setup operations; host gating of native actions; and a text vertical-slice checkpoint on the existing production `/capability` and `/settings` mounts.
- **Out of scope:** hosted trial, new runtime engines, in-app Docker management, a global GPU scheduler, OS driver installation, new speech/music/ambience/video implementations, and any UI redesign (C-483, C-484).

## Implementation Phases

One PR. Work these in order; each intermediate state must compile, pass tests and leave the app working.

1. **Download and redirect integrity.** Hop-by-hop validator (scheme, host, port, destination class), hop cap, cross-origin credential drop, destination path validation, checksum and size verification anchored to the catalog, per-job temp identity and atomic promotion.
2. **Host gating.** Guard native install/probe actions at the action boundary so the browser never offers them, while browser online-provider, existing-server and supported local/browser voice setup stay available.
3. **Shared catalog and native planning.** One shared catalog describing artifacts, checksums, sizes, licenses and resource budgets; one artifact resolver; remove the four hand-built URL sites and the `include_str!` cross-app import; a planner selecting compatible models per host independent of Docker and passthrough.
4. **Durable jobs.** Job state outside the ViewModel, real cancellation reaching the native transfer, restart recovery, retry-safe resumption that never corrupts a valid artifact, and an ownership precondition guarding every destructive path.
5. **Owned process lifecycle.** Explicit ownership; start, stop and on-demand restart for owned processes only; port conflict detection and visible failure; argument and artifact-ID validation for native commands.
6. **Provision through canonical setup.** Express install → verify → persist → real text request through C-481's operations, with duplicate-registration prevention, and prove the four journeys on the existing production mounts: existing server, online provider, packaged native text, and offline reopen.

**Size gate.** Report per-file additions and deletions including tests. Target ≤60 changed files, hard stop at 100. Never end the PR with two live download or lifecycle paths. If the budget is reached, stop at the last complete phase and report the remainder as an explicit follow-up.

## Acceptance Criteria

### AC-1: Downloads survive real CDNs and reject hostile hops
**Given** a real catalog CDN redirect chain and hostile alternatives
**When** downloading
**Then** the valid asset verifies, and unsafe hops, ports, paths, sizes or hashes fail without replacing good data.

**Verification**: injected HTTP plus native integration matrix — multi-hop CDN, downgrade, port/host change, private destination, hop cap, credential drop, traversal and symlink target; optional metadata-only live redirect check.

### AC-2: Native planning is independent of containers
**Given** native hardware without a container runtime
**When** planning
**Then** native support and fit are independent of Docker and GPU passthrough, and accurate warnings, licenses and total bytes are shown.

**Verification**: planner fixtures — CPU-only, supported GPUs, no container runtime, insufficient disk or memory, context/KV overhead, companion files, acknowledgement-required entries.

### AC-3: Cancellation and retry are real and safe
**Given** an approved job
**When** it is cancelled, interrupted or retried after restart
**Then** the underlying native transfer stops and reconciles, and verified assets remain reusable without duplicate or colliding writes.

**Verification**: transport and journal integration tests; cancellation during download, verify and start; concurrent same-artifact jobs; `Range` resume and restart-safe cases.

### AC-4: Only owned processes are controlled
**Given** an occupied port or an external healthy server
**When** starting or stopping Aikami
**Then** it controls only its own process, verifies engine and model identity before reporting ready, and the external process stays alive and unclaimed.

**Verification**: native port-conflict, bind-race, crash and quit tests; a foreign `/health` responder rejected; external process untouched after app quit.

### AC-5: Offline reopen reaches a token
**Given** an installed owned engine
**When** reopening offline and generating
**Then** it starts on demand and canonical registration remains stable without rerunning the wizard.

**Verification**: packaged native text install → quit → offline reopen → generation, per advertised platform. Unavailable hardware is reported explicitly unverified, never assumed.

### AC-6: Discovery reuses without claiming; browsers get no native actions
**Given** cloud configuration and a compatible existing local server
**When** the user explicitly scans
**Then** reuse is offered without mutation and stays an external connection; ownership is never upgraded from detection; and a browser never exposes native install or probe entry points, with zero native executor calls on web, while supported browser and server paths remain.

**Verification**: discovery mixed-source, permission and timeout tests; browser × desktop × text-missing/present matrix; production `/capability` browser E2E; finding a server must not install a model.

### AC-7: Optional work never traps text-ready play
**Given** text plus optional image or voice work
**When** optional setup fails or resources are tight
**Then** text-ready play remains available and optional work is bounded and recoverable.

**Verification**: job dependency and resource fixtures; mixed-provider production journey.

### AC-8: One artifact identity across consumers
**Given** shared catalog updates and an existing CLI installation
**When** built and loaded
**Then** native, browser and CLI consumers agree on artifact identity, URLs derive from one resolver, and existing `.env` and target paths remain compatible.

**Verification**: catalog, schema and CLI fixtures plus bundle inspection; no hand-built artifact URL and no cross-app source import remain.

## Edge Cases & Gotchas

- No manifest means an actionable failure, not an empty successful plan. Registry and model IDs are not filesystem paths.
- A fixed `<file>.part` sibling collides across concurrent or retried jobs. Content-length may be absent, wrong, or larger than the pinned size.
- Cancelling near registration must not persist a ready connection to a stopped or unverified runtime.
- An existing Ollama, LM Studio or previous Aikami sidecar may already hold the port.
- Do not test only against development mocks or the `src-tauri/binaries` shims; a mocked Tauri global is not packaged desktop evidence.
- Avoid static Tauri imports in browser code; preserve the existing injection and testing seams.
- Do not broaden Tauri HTTP/CSP permissions to unrestricted URLs, or promise the browser can bypass CORS or local-network permission policy.

## Open Questions

None delegated. Approval covers one artifact resolver, a validated-hop redirect policy, cancellable jobs with an inventory separate from the vault, and ownership that is recorded rather than inferred. The concrete hop and port policy, and any dynamic-port capability change, are decided within those constraints. Signed-build availability is verified against release configuration before advertising a support matrix; do not invent GPU or platform support. Material security or schema changes require an amendment.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.1.0 | 2026-09-05 | Verified draft claims against `acb7a18e` and tightened them with concrete anchors; added Success Measures; specified per-job temp identity, resume, ownership recording, capability-policy limits and catalog/`originUrl` migration safety. | User |
| 2.0.0 | 2026-09-06 | Withdrew the C-489–C-494 split and re-merged that scope into this single one-PR contract; absorbed the P01 desktop-gating packet into AC-6; added *Implementation Phases* with an explicit PR-size gate; made merged C-481 a hard dependency. | User |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
