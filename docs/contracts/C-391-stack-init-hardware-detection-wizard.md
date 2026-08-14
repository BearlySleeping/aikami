---
id: C-391
title: "`stack init` — Hardware Detection, Modality Selection, and Model Recommendation"
source: "user request — 'a recommended model for text, image, voice, speech based on the computer/user preference... most optimal and easiest for the user to setup'"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-13"
---

# Contract C-391: `stack init` — Hardware Detection, Modality Selection, and Model Recommendation

## Metadata

| Field | Value |
|---|---|
| **Source** | Local-stack engine review, 2026-08-13. C-390 makes the stack *work*; this contract makes it *easy*. The user should never have to know what a compose override file is, what CUDA 12 vs 13 means, or which quantization fits their VRAM. |
| **Target** | `packages/shared/local-ai/` (new — portable planning core), `packages/shared/{schemas,types}/`, `apps/backend/local-stack/stack/` (CLI adapter, wizard, `.env` generation) |
| **Priority** | P1 — without it, C-390 requires hand-editing `.env`, which is the setup cost this whole effort exists to remove. |
| **Dependencies** | C-390 (the `.env` contract, `models.manifest.json`, and the fetcher must exist first). |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing → the quick-start section of "Run Aikami locally" becomes two commands |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **After C-390 the stack works but presupposes expert knowledge.** The user must choose a backend override file, know whether their driver is CUDA 12 or 13, pick a model whose quantized size fits their VRAM, and understand that `COMPOSE_FILE` is colon-separated on POSIX and semicolon-separated on Windows. Every one of those is a place to get it wrong silently.

- **Getting it wrong fails late and opaquely.** A model larger than available VRAM does not fail at start — `llama-server` loads, then either offloads to system RAM and runs at a fraction of the expected speed, or the container is OOM-killed mid-generation. The user experiences "Aikami is slow/broken", not "you picked a model too big for your GPU".

- **There is no existing detection anywhere in the repo.** `scripts/src/lib/herdr/` orchestrates dev services but never inspects hardware. `apps/backend/image/` assumes an NVIDIA GPU unconditionally (`--device nvidia.com/gpu=all` in its documented run flags) with no fallback.

- **Modality choice is real and currently unexpressed.** A user who only wants text generation should not download a 6 GB image model. C-390 gives them profiles to express that; nothing helps them decide.

- **Existing implementation to reuse**:
  - `scripts/src/lib/` — the established home for repo tooling, its Bun/TypeScript conventions, and its logging style.
  - `packages/shared/constants/src/lib/development_ports.ts` — the port source of truth the generated `.env` must agree with.
  - C-390's `models.manifest.json` (tiers, licences, sizes, digests) and its fetcher — this contract chooses entries; it does not download.

- **Known gaps**: no probe, no wizard, no `.env` writer, no disk-space check, no re-run story.

- **Baseline tests**: C-390 merged and `bun moon run local-stack:test` green.

## User Outcome

After this contract, a **new user** runs `bun run stack init`, answers up to
three questions, and gets a `.env` matched to their machine plus an explicit
plan of what will be downloaded and how much disk it needs — before anything
is fetched.

## Success Measures

- **Time/latency target**: detection completes in under 3 s on every supported platform, including when GPU tooling is absent (each probe is individually timed out).
- **Offline/degraded behavior**: detection is entirely local — no network. With every GPU probe failing, it reports `cpu` and produces a valid working configuration rather than an error.
- **Production journey enabled**: `bun run stack init && docker compose up -d` becomes the complete install instruction in the README and on the project landing page.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Shared package conventions | `packages/shared/*` (`@aikami/<name>`) | reuse as pattern for the new `local-ai` package |
| Schema/type placement | `packages/shared/schemas/`, `packages/shared/types/` | reuse |
| Repo tooling conventions | `scripts/src/lib/` | reuse as pattern for the CLI adapter |
| Port constants | `development_ports.ts` | reuse |
| Model catalog + tiers | C-390 `stack/models.manifest.json` | reuse |
| Model download | C-390 `stack/fetch_models.ts` | reuse — invoked, not reimplemented |
| `.env` contract | C-390 `StackEnv` | reuse |

## Overview

Add a detection module that probes GPU vendor, VRAM, system RAM, CPU cores,
platform, and free disk; a recommendation module that maps that profile plus
the user's chosen modalities onto manifest entries and a backend; and a
wizard that presents the plan, takes confirmation, and writes `.env`. Fully
scriptable via flags so CI and power users never see a prompt.

## Design Reference

Probe order, each independently timed out and non-fatal on failure:

| Probe | Command / source | Yields |
|---|---|---|
| NVIDIA | `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader` | vendor, VRAM MB, driver → CUDA 12 vs 13 |
| AMD | `rocm-smi --showmeminfo vram` or `rocminfo` | vendor, VRAM MB |
| Vulkan | `vulkaninfo --summary` | vendor, device type (covers Intel Arc and iGPUs) |
| Apple | `uname -m` + `sysctl hw.memsize` | `metal`, unified memory |
| RAM | `/proc/meminfo` (Linux), `sysctl hw.memsize` (Darwin), `wmic`/PowerShell (Windows) | total MB |
| Cores | `nproc` / `sysctl hw.ncpu` | thread count for `llama-server -t` |
| Disk | `statvfs` on the target volume path | free bytes |
| Runtime | `docker info` / `podman info` | container runtime present, and whether the NVIDIA toolkit is wired up |

Tier selection uses **usable VRAM**, not total: reserve headroom (a fixed
margin plus what the desktop compositor already holds) so the recommendation
does not assume an idle GPU. On Apple Silicon, unified memory is shared with
the OS — treat usable as a fraction of total, not the whole.

**Headroom rule (baked into the tier table, tuneable constants):** usable VRAM
= 70% of reported VRAM for dedicated GPUs; usable memory = 50% of total RAM
for unified-memory systems (Apple Silicon, iGPUs). A manifest entry is
eligible for a profile only when its file size ≤ usable VRAM/memory. The tier
thresholds themselves live **in code** as a typed constant in `@aikami/local-ai`
(`TIER_TABLE: { minUsableBytes, tier }[]`), not in C-390's manifest — the
manifest is C-390's and is out of scope to edit; its per-entry `tier` labels
(`cpu` / `8gb` / `16gb` / `any`) are the vocabulary the table maps onto.

Guiding principle: **recommend the largest model that fits comfortably, not
the largest that fits.** A model that just barely fits produces the slow,
swapping experience described in the Problem section, which reads to the user
as a broken product.

Non-interactive form:
```
bun run stack init --yes --backend cuda --modalities text,voice --tier auto
```

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **The planning core lives in a shared package, not in the stack project.**
  Create `packages/shared/local-ai` (`@aikami/local-ai`) holding the manifest
  loader, the tier table, the probe-executor interface, and the pure
  recommendation function. It must have **no dependency on
  `apps/backend/local-stack`**, no Node/Bun-only imports (`node:child_process`,
  `node:fs`) in its public entry point, and no assumption that a container
  runtime exists. Following repo convention, the TypeBox schemas go in
  `packages/shared/schemas/` and the derived types in `packages/shared/types/`;
  the new package holds the logic that consumes them.

  This is what lets a second frontend — the Tauri desktop app running the
  wizard natively, or an in-app settings screen — import the same
  recommendation logic without pulling in the stack project, and it is why the
  package boundary is a contract requirement rather than a preference. A
  future non-Docker wizard reuses the core and supplies its own adapters.

- **Detection is pure and injectable.** The probe layer returns a
  `HardwareProfile`; the recommendation layer is a pure function of
  `(HardwareProfile, StackModality[], Manifest) → StackPlan`. This is what
  makes the recommendation table testable without the hardware.

- **The probe executor is an injected interface with a documented contract, not
  a direct process spawn.** `@aikami/local-ai` never calls a process itself; it
  declares `ProbeExecutor` and receives an implementation. Adding a new host —
  Tauri invoking Rust commands, a test harness replaying fixtures, a remote
  provisioning agent — is therefore **writing a new adapter, not refactoring
  the core**. The contract each adapter must satisfy:

  | Guarantee | Requirement |
  |---|---|
  | Signature | `run(command: string, args: readonly string[], options: { timeoutMs: number }): Promise<ProbeResult>` |
  | No shell | The command and args are passed as a fixed array. An adapter must never build or evaluate a shell string. |
  | Never throws | A missing binary, a non-zero exit, a timeout, and a permission denial all resolve to a `ProbeResult` with `ok: false` and a discriminated `reason`. Rejection is reserved for adapter bugs. |
  | Honours the timeout | The promise settles within `timeoutMs`; the child process is killed, not merely abandoned. |
  | Byte-faithful | `stdout` and `stderr` are returned undecorated — no trimming, locale translation, or colour stripping, because the parsers depend on exact output. |
  | Side-effect free | Probes are read-only. An adapter must not be used for commands that mutate state. |
  | Filesystem reads | `readTextFile` and `statfs` are part of the same interface, since `/proc/meminfo` and free-disk checks are probes too and must be stubbable identically. |

  Three adapters are expected: a Bun/CLI one (this contract), a Tauri one (a
  later contract), and a fixture-replay one (this contract, for tests).
- **Never download during `init`.** `init` produces a plan and a `.env`.
  Downloading is C-390's fetcher, invoked afterwards — separately runnable and
  separately interruptible.
- **Always show the plan before writing.** Chosen backend, chosen models with
  sizes, total download, free disk, and the ports that will be bound.
- **Refuse to plan a download that does not fit on disk.** Fail with the
  shortfall stated in GB, and offer the next tier down.
- **Every prompt has a non-interactive flag**, and `--yes` accepts every
  recommendation. `init` must be usable in CI and in a scripted installer.
- **Re-running is safe and idempotent.** Detect an existing `.env`, show a
  diff, and require confirmation before overwriting. Never silently discard
  user edits.
- **Explain each choice in one line.** "RTX 4070, 12 GB → Mistral-Nemo 12B
  Q4_K_M (7.5 GB), leaves 4.5 GB headroom" teaches the user their own machine.
- **Surface licence obligations at plan time.** If the plan includes a
  use-restricted model (SD 1.5, OpenRAIL-M), name the licence in the plan —
  not only at download time in the fetcher.
- **Emit the correct `COMPOSE_FILE` separator for the host platform.**

## State & Data Models

Placement, per the directives above:

| Artifact | Home |
|---|---|
| TypeBox schemas for `HardwareProfile`, `StackPlan`, `ModelManifest` | `packages/shared/schemas/` |
| Derived types | `packages/shared/types/` |
| `ProbeExecutor` interface, tier table, manifest loader, `recommend()` | `packages/shared/local-ai/` (`@aikami/local-ai`) |
| Bun/CLI `ProbeExecutor` adapter, wizard, `.env` writer | `apps/backend/local-stack/stack/` |
| Fixture-replay `ProbeExecutor` adapter | `packages/shared/local-ai/` test exports |

```ts
/** The injected boundary. Implemented per host; never implemented in the core. */
type ProbeResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  | { readonly ok: false; readonly reason: 'not-found' | 'timeout' | 'denied' | 'failed'; readonly detail?: string };

type ProbeExecutor = {
  run(
    command: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ProbeResult>;
  /** Probing /proc/meminfo and friends — stubbable on the same seam. */
  readTextFile(path: string): Promise<ProbeResult>;
  /** Free-space check against the volume backing a given path. */
  statfs(path: string): Promise<{ readonly freeBytes: number } | { readonly ok: false }>;
};

type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'none';

type HardwareProfile = {
  readonly platform: 'linux' | 'darwin' | 'win32';
  readonly arch: 'x64' | 'arm64';
  readonly gpu: {
    readonly vendor: GpuVendor;
    readonly name?: string;
    readonly vramMb?: number;
    /** NVIDIA only — decides server-cuda vs server-cuda13. */
    readonly cudaMajor?: 12 | 13;
    /** True when the GPU shares system RAM (Apple Silicon, iGPU). */
    readonly unifiedMemory: boolean;
  };
  readonly ramMb: number;
  readonly cores: number;
  readonly freeDiskBytes: number;
  readonly containerRuntime: 'docker' | 'podman' | 'none';
  /** NVIDIA Container Toolkit detected — GPU containers will actually work. */
  readonly gpuPassthroughReady: boolean;
};

type StackPlan = {
  readonly backend: StackBackend;               // from C-390
  readonly modalities: readonly StackModality[];
  readonly models: readonly {
    readonly manifestId: string;
    readonly modality: StackModality;
    readonly bytes: number;
    readonly license: string;
    readonly requiresAcknowledgement: boolean;
    /** One-line human justification shown in the plan. */
    readonly rationale: string;
  }[];
  readonly totalDownloadBytes: number;
  readonly warnings: readonly string[];
  /** True when engines must run natively rather than in containers (macOS). */
  readonly nativeEngines: boolean;
};
```

Note that `StackBackend` and `StackModality` are specified in C-390's design
reference and their value sets are instantiated in `apps/backend/local-stack/.env.example`
(`COMPOSE_FILE` backends and `COMPOSE_PROFILES` modalities), but C-390 shipped **no
TS types** for them — its consumers read `.env`/compose directly. This contract
**introduces the TS types in `packages/shared/types/`** (derived from the
`.env.example` value sets: backend `'cpu' | 'cuda' | 'rocm' | 'vulkan' | 'intel' |
'musa' | 'metal'`, modality `'text' | 'image' | 'voice' | 'stt' | 'web' | 'ollama'
| 'comfyui'` — `'metal'` kept from the C-390 design for the native macOS plan, and
`'intel' | 'musa'` per the shipped override files) so the planning core can
reference them without depending on the stack project, and updates C-390's
consumers to import from there.

## Quality Requirements

- **Offline/degraded mode**: no network use at all. All probes fail → `cpu` backend, smallest tier, valid `.env`.
- **Accessibility/input**: plain-text output that degrades without colour or Unicode; every prompt answerable by flag; respects `NO_COLOR`.
- **Performance budget**: total detection under 3 s, each probe individually capped at 1 s.
- **Security/privacy**: probes are read-only, invoked with fixed argument lists — never a shell string built from probe output. No telemetry; the hardware profile never leaves the machine.
- **Persistence/migration**: `.env` overwrite requires confirmation and shows a diff; the previous file is backed up.
- **Cancellation/retry/idempotency**: interrupting `init` leaves no partial `.env`; write atomically via temp file plus rename.
- **Observability**: `--json` emits the `HardwareProfile` and `StackPlan` for bug reports and CI assertions.

## Migration & Rollback

- **Old data compatibility**: an existing hand-written `.env` from C-390 is detected, diffed, and preserved unless the user confirms.
- **Migration**: none — `init` is additive.
- **Rollback**: delete the generated `.env` and hand-write one per the C-390 README; the stack does not depend on the wizard at runtime.
- **Feature flag or kill switch**: N/A — an opt-in command.
- **Failure recovery**: atomic write means a crashed `init` leaves the prior `.env` intact.

## Scope Boundaries

- **In Scope:**
  - New `packages/shared/local-ai` package holding the portable planning core, with schemas and types placed per repo convention.
  - The `ProbeExecutor` interface and its documented contract, plus two adapters: Bun/CLI and fixture-replay.
  - Introducing `StackBackend` / `StackModality` types in `packages/shared/types/` (per C-390's design reference and `.env.example` value sets) and repointing any C-390 consumers.
  - Hardware detection across Linux, macOS, and Windows/WSL2.
  - Pure recommendation function mapping profile + modalities → backend + models.
  - Interactive wizard with full non-interactive flag coverage.
  - Plan presentation including sizes, disk check, ports, licences, and warnings.
  - Atomic `.env` generation with platform-correct `COMPOSE_FILE` separator.
  - `--json` output and re-run/diff handling.
- **Out of Scope:**
  - Downloading anything — C-390's fetcher.
  - Editing the model catalog — the manifest is C-390's.
  - A GUI or in-app settings surface. CLI only.
  - Benchmarking to auto-tune parameters. Static tiers only; measured tuning is a possible follow-up.
  - The **Tauri `ProbeExecutor` adapter and any in-app wizard UI.** This contract makes them a drop-in addition by fixing the interface; building them is a later contract.
  - Automatically installing drivers, the NVIDIA Container Toolkit, or Docker. Detect and instruct; never install.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — a correct `.env` chosen for the user.
Detection without recommendation produces nothing usable, and recommendation
without detection is the hand-editing this contract exists to remove. Kept as
one contract, and cleanly separated from C-390 because the stack is fully
functional without it.

## Acceptance Criteria

### AC-0: The planning core is importable without the stack project
**Given** `@aikami/local-ai`
**When** its `package.json` dependencies and its public entry point's import graph are inspected
**Then** it depends on neither `@aikami/local-stack` nor any app, imports no Node/Bun-only module (`node:child_process`, `node:fs`, `node:os`) in its public entry point, and a consumer that imports `recommend()` and the manifest types builds successfully with only `@aikami/local-ai`, `@aikami/types`, and `@aikami/schemas` installed.

### AC-0b: A new host is an adapter, not a refactor
**Given** the fixture-replay `ProbeExecutor` implementation
**When** the full detection and recommendation pipeline runs against captured fixtures with **zero** process spawns
**Then** it produces the same `StackPlan` as the Bun/CLI adapter given equivalent inputs — proving the core is host-agnostic and that a Tauri adapter needs no change to `@aikami/local-ai`.

### AC-0c: The executor contract holds for every adapter
**Given** each `ProbeExecutor` implementation
**When** exercised against a missing binary, a non-zero exit, a hanging process, and a permission-denied path
**Then** every case resolves (never rejects) with the correct `reason`, a hanging process settles within `timeoutMs` and is killed rather than abandoned, and `stdout` is returned byte-faithfully with no trimming or colour stripping.

### AC-1: Detection degrades to CPU without error
**Given** a Linux (or native Windows) machine with no GPU tooling on `PATH` (no `nvidia-smi`, `rocm-smi`, or `vulkaninfo`) — on macOS the Apple probe always succeeds and is covered by AC-4
**When** `stack init --yes` runs
**Then** it completes with exit status 0, reports `gpu.vendor === 'none'` and `backend === 'cpu'`, and writes a valid `.env`.

### AC-2: NVIDIA detection selects the matching CUDA image
**Given** a stubbed `nvidia-smi` reporting a 12 GB card on a CUDA 12 driver
**When** the plan is computed
**Then** `backend === 'cuda'` and `cudaMajor === 12`; **and** with a CUDA 13 driver, `cudaMajor === 13` — so C-390 selects `server-cuda` versus `server-cuda13` correctly.

### AC-3: Tier selection respects usable VRAM, not total
**Given** stubbed profiles at 4, 8, 12, and 24 GB VRAM and the headroom rule from the Design Reference (usable = 70% of reported VRAM for dedicated GPUs)
**When** the text model is recommended for each
**Then** each selection's file size is ≤ 70% of reported VRAM, the selection is the largest manifest tier whose entry fits within usable VRAM, and no selection assumes the full reported VRAM is free — 4 GB → `cpu` tier (Qwen 1.5B), 8 GB → `8gb` tier (Qwen 7B), 12 GB → `8gb` tier unless a 16 GB-tier entry fits within 8.4 GB usable (top-tier fallback warns), 24 GB → `16gb` tier.

### AC-4: Unified memory is not treated as VRAM
**Given** an Apple Silicon profile with 16 GB unified memory
**When** the plan is computed
**Then** the recommendation is based on the headroom rule (usable = 50% of total memory, i.e. 8 GB usable for a 16 GB machine) rather than all 16 GB, and `nativeEngines === true`.

### AC-5: Modality selection controls the download set
**Given** `--modalities text`
**When** the plan is computed
**Then** it contains exactly one text model and no image, TTS, or STT entries, and `COMPOSE_PROFILES` in the written `.env` is `text`.

### AC-6: Insufficient disk fails before writing
**Given** a plan requiring more bytes than are free on the target volume
**When** `stack init` runs
**Then** it exits non-zero, states the shortfall in GB, suggests the next tier down, and writes no `.env`.

### AC-7: Plan is shown before anything is written
**Given** an interactive run
**When** the plan is computed
**Then** backend, per-model sizes with one-line rationale, total download, free disk, licences, and bound ports are printed **before** the confirmation prompt, and declining writes nothing.

### AC-8: Fully non-interactive
**Given** `--yes --backend cuda --modalities text,voice`
**When** `stack init` runs with no TTY
**Then** it completes without prompting and honours every supplied flag over its own detection.

### AC-9: Re-run is safe
**Given** an existing `.env` with a hand-edited value
**When** `stack init` runs again
**Then** the differences are shown and confirmation is required; declining leaves the file byte-identical.

### AC-10: Generated `.env` actually starts the stack
**Given** a `.env` produced by `stack init --yes` on the CPU path
**When** `docker compose config` is rendered and the stack is started with models present
**Then** it renders without error and every enabled service reaches `healthy` — the C-390 AC-4 assertion, driven by generated rather than hand-written configuration.

### AC-11: Platform-correct separator
**Given** a Windows platform profile
**When** `.env` is written
**Then** `COMPOSE_FILE` uses `;` as its separator, and `:` on Linux and macOS.

### AC-12: Missing GPU passthrough is caught, not assumed
**Given** an NVIDIA GPU present but the NVIDIA Container Toolkit absent, and no explicit `--backend` flag
**When** the plan is computed
**Then** `gpuPassthroughReady === false`, a warning naming the missing toolkit and its install URL appears in the plan, and the backend falls back to `cpu` rather than generating a configuration that fails at `up`. An explicit `--backend cuda` still obeys (Edge Cases: user overrides) with a loud warning.

### AC-13: `--json` output is complete and stable
**Given** `stack init --yes --json` on a machine with known hardware
**When** the command completes
**Then** stdout is a single JSON document containing the full `HardwareProfile` and `StackPlan` (schema-validated against the TypeBox schemas in `packages/shared/schemas/`), suitable for CI assertions and bug reports.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-0 | Unit | dependency-graph assertion in `local-ai` tests | N/A | Filled during verification |
| AC-0b | Unit | `local-ai/recommend.test.ts` with fixture executor | N/A | Filled during verification |
| AC-0c | Unit | `local-ai/probe_executor.contract.test.ts` — shared suite run against every adapter | N/A | Filled during verification |
| AC-1 | Unit | `stack/detect.test.ts` — empty PATH | N/A | Filled during verification |
| AC-2 | Unit | `stack/detect.test.ts` — stubbed `nvidia-smi` | N/A | Filled during verification |
| AC-3 | Unit | `stack/recommend.test.ts` — VRAM table | N/A | Filled during verification |
| AC-4 | Unit | `stack/recommend.test.ts` — Apple profile | N/A | Filled during verification |
| AC-5 | Unit | `stack/recommend.test.ts` | N/A | Filled during verification |
| AC-6 | Unit | `stack/init.test.ts` — stubbed `statvfs` | N/A | Filled during verification |
| AC-7 | Unit | `stack/init.test.ts` — output-order snapshot | N/A | Filled during verification |
| AC-8 | Integration | `scripts/check.sh` — non-TTY invocation | N/A | Filled during verification |
| AC-9 | Unit | `stack/init.test.ts` — byte-identical assertion | N/A | Filled during verification |
| AC-10 | Integration | `scripts/check.sh` — generated-`.env` boot | CI: `stack init --yes` (CPU) → `docker compose config` + boot | Filled during verification |
| AC-11 | Unit | `stack/init.test.ts` — both platforms | N/A | Filled during verification |
| AC-12 | Unit | `stack/detect.test.ts` — stubbed `docker info` | N/A | Filled during verification |
| AC-13 | Unit | `stack/init.test.ts` — `--json` schema validation | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run local-ai:test`, `bun moon run local-ai:typecheck`, `bun moon run local-stack:test`, `bun moon run local-stack:typecheck`
- Integration: CI runs `stack init --yes` on the Linux runner (no GPU) and boots the resulting configuration with the smallest text model.
- E2E / Visual:
    - **Functional**: N/A — CLI only, covered by unit and integration tests.
    - **Visual**: N/A.

**Watch Points**:
- `nvidia-smi` exists inside WSL2 but reports differently from native Linux, and GPU passthrough there depends on the Windows-side driver. Test WSL2 explicitly rather than assuming Linux behaviour.
- `wmic` is deprecated on Windows 11. The RAM probe must prefer PowerShell CIM (`Get-CimInstance Win32_ComputerSystem`) and fall back to `wmic` only on older hosts — a probe that fails must degrade to `ramMb: 0` + warning, never crash.
- `vulkaninfo` can hang without a display. Enforce the per-probe timeout and never let it block.
- `nvidia-smi` reports **total** VRAM, not free. A machine mid-game or running another model has far less available. The headroom margin is what protects against this.
- Multi-GPU machines report multiple rows. Pick the largest single device — the engines default to one device, and summing VRAM across cards would badly over-recommend.
- Free disk must be measured on the **volume backing the Docker data root**, which on Docker Desktop is a VM disk, not the user's home directory. Checking the wrong path gives a confidently wrong answer.
- Probe output must never be interpolated into a shell string. Use fixed argument arrays — the `ProbeExecutor` contract forbids shell strings, and the interface signature is what makes that enforceable.
- **The package boundary is easy to violate by accident.** A single convenience `import { spawn } from 'node:child_process'` inside `@aikami/local-ai` silently breaks the Tauri path months later, and nothing fails at the time. AC-0 must be a build-time assertion in CI, not a code-review convention.
- The fixture-replay adapter is only as good as its fixtures. Capture real `nvidia-smi`, `rocm-smi`, and `vulkaninfo` output from actual machines — including a multi-GPU box and a laptop with hybrid graphics — rather than hand-writing plausible strings.

## Implementation Sequence

1. **Phase 0 (Package)**: scaffold `packages/shared/local-ai`; define `ProbeExecutor` and its shared contract test suite; introduce `StackBackend` / `StackModality` types in `packages/shared/types/` (from C-390's design reference / `.env.example`) and repoint any C-390 consumers.
2. **Phase 1 (Detection)**: probe modules in the core, written only against `ProbeExecutor`; the Bun/CLI and fixture-replay adapters; `HardwareProfile`; tests against fixtures captured from real machines.
3. **Phase 2 (Recommendation)**: pure `(profile, modalities, manifest) → StackPlan` with the tier table and headroom rules; table-driven tests. Still no I/O in the core.
4. **Phase 3 (Wizard)**: prompts, flags, plan rendering, disk check, atomic `.env` write, re-run diff — all in `local-stack`, consuming the core.
5. **Phase 4 (Integration)**: wire the CLI entry into `apps/backend/local-stack/package.json` (script `init`) and `apps/backend/local-stack/moon.yml` (task `init`, `runInCI: false`), and add a root `package.json` script `"stack": "bun moon run local-stack:init --"` so `bun run stack init` resolves from the repo root — the form the README quick-start promises; rewrite the README quick-start to two commands.
6. **Phase 5 (Validation)**: `bun moon run local-ai:test`, `bun moon run local-stack:test`, `:typecheck`, `:lint`, plus the CI generated-`.env` boot.

## Edge Cases & Gotchas

- **GPU present but unusable** (driver too old for the CUDA image, Secure Boot blocking the module): detection sees a card, the container fails at load. Where cheaply checkable, verify the driver version against the image's minimum and warn.
- **Laptop hybrid graphics**: `nvidia-smi` may report a dGPU that is powered down or unavailable to containers. Warn rather than assume.
- **User overrides that contradict hardware**: `--backend cuda` on a machine with no NVIDIA GPU must warn loudly and still obey — the user may be provisioning for a different machine.
- **Manifest tier missing for a detected profile**: fall back to the next smaller tier and warn; never emit a `.env` referencing a nonexistent manifest id.
- **Very large VRAM (48 GB+)**: the top tier is the top tier. Say so explicitly rather than appearing to under-recommend.
- **Rootless podman** maps container uids into a subuid range, which changes model-volume permissions. Detect podman and note it in the plan.
- **`init` run inside a container** (some users will try): detection sees the container's view, not the host's. Detect and refuse.

## Resolved Decisions

Formerly open questions — resolved at review (2026-08-14) with the proposals below; real-hardware calibration of the headroom margins is tracked as a follow-up, not a blocker:

- **Headroom margin: 70% of reported VRAM for dedicated GPUs, 50% of total memory for unified-memory systems.** Adopted as tuneable constants in `@aikami/local-ai`'s tier table (see Design Reference). The percentage is an engineering default that keeps the recommendation honest against a busy desktop; AC-3/AC-4 assert the invariant so a future recalibration is a one-line constant change plus a test update. Real-hardware validation (multiple GPU generations, busy-desktop VRAM deltas) is a documented follow-up outside this contract.
- **Fetcher chaining: separate by default, `--fetch` to chain.** `init` never downloads; a multi-gigabyte download must never be an accidental side effect of a configuration command. The `--fetch` flag is optional and off by default.
- **Tier table location: thresholds in code, vocabulary in the manifest.** `TIER_TABLE` (min usable bytes → tier) lives in `@aikami/local-ai` as a typed, tested constant; C-390's manifest keeps its per-entry `tier` labels and is not edited by this contract (Out of Scope: "the manifest is C-390's").

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Built the `stack init` wizard end-to-end: a new portable planning core in
`packages/shared/local-ai` (`@aikami/local-ai`) holding the `ProbeExecutor`
seam, tier table with headroom rules, manifest loader, detection, and the
pure `recommend()` function; TypeBox schemas + derived types for
`HardwareProfile`, `StackPlan`, `ModelManifest`, `StackBackend` and
`StackModality`; and the Bun/CLI adapter, interactive wizard, plan renderer,
disk guard, atomic `.env` writer with diff/backup, and `--json` in
`apps/backend/local-stack/stack/`. Wired `bun run stack init` from the repo
root, added moon tasks, updated the README quick-start and the docs page to
the two-command form, and added check.sh integration hooks (AC-8/AC-10).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-0 | ✅ | dependency.test.ts asserts package.json deps and no `node:` imports in the public entry graph |
| AC-0b | ✅ | fixture_executor.test.ts runs detect→recommend against fixtures with zero spawns |
| AC-0c | ✅ | probe_executor.contract_suite.ts run against both fixture-replay and Bun/CLI adapters |
| AC-1 | ✅ | detect.test.ts (local-ai + local-stack) — no GPU tooling → vendor none, backend cpu, valid plan |
| AC-2 | ✅ | stubbed nvidia-smi driver 535→CUDA 12, 580→CUDA 13; backend cuda; TEXT_SERVER_IMAGE extra on cuda13 |
| AC-3 | ✅ | VRAM table 4/8/12/24 GB — cpu/8gb/16gb(+fallback warning) tiers, shipped-manifest test included |
| AC-4 | ✅ | Apple 16 GB unified → 50% headroom (8 GB usable), nativeEngines true |
| AC-5 | ✅ | modalities control models + COMPOSE_PROFILES; voice→tts, web adds none |
| AC-6 | ✅ | init.test.ts — huge manifest → exit 2, shortfall in GB, no .env written |
| AC-7 | ✅ | plan printed before confirmation; TTY-stubbed decline writes nothing |
| AC-8 | ✅ | check.sh --static runs `stack init --yes` non-interactively; root `bun run stack init` verified |
| AC-9 | ✅ | init.test.ts — re-run diff shown, non-TTY decline leaves file byte-identical |
| AC-10 | ✅ | check.sh --static: generated .env renders with `docker compose config` (docker compose available via Nix podman shim) |
| AC-11 | ✅ | env_writer renderEnv — `:` on linux, `;` on win32 |
| AC-12 | ✅ | detect.test.ts + recommend.test.ts — GPU without toolkit → cpu fallback warning; explicit `--backend cuda` obeys loudly |
| AC-13 | ✅ | init.test.ts — `--json` stdout is one schema-valid doc (HardwareProfile + StackPlan via Value.Check) |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/local-ai/package.json` | `@aikami/local-ai` package manifest |
| `packages/shared/local-ai/tsconfig.json` | tsconfig with shared package paths |
| `packages/shared/local-ai/moon.yml` | moon project (test task) |
| `packages/shared/local-ai/src/index.ts` | public entry — AC-0 boundary, re-exports types |
| `packages/shared/local-ai/src/lib/probe_executor.ts` | ProbeExecutor / ProbeResult / StatfsResult seam |
| `packages/shared/local-ai/src/lib/probe_executor.contract_suite.ts` | shared AC-0c contract suite |
| `packages/shared/local-ai/src/lib/tier_table.ts` | TIER_TABLE, headroom rules, usableBytesForProfile |
| `packages/shared/local-ai/src/lib/manifest.ts` | pure manifest parse + executor-seam loader |
| `packages/shared/local-ai/src/lib/recommend.ts` | pure `recommend()` → StackPlan |
| `packages/shared/local-ai/src/lib/detect.ts` | detectHardware over ProbeExecutor |
| `packages/shared/local-ai/src/lib/fixture_executor.ts` | fixture-replay adapter (AC-0b) |
| `packages/shared/local-ai/src/lib/*.test.ts` | manifest/tier_table/recommend/detect/fixture_executor/dependency tests (48) |
| `packages/shared/schemas/src/lib/local_ai/*.ts` | HardwareProfile/ModelManifest/StackBackend/StackPlan schemas |
| `packages/shared/types/src/lib/local_ai/*.ts` | derived Static types |
| `apps/backend/local-stack/stack/probe_executor.ts` | Bun/CLI adapter (spawn, readTextFile, statfs) |
| `apps/backend/local-stack/stack/env_writer.ts` | renderEnv, diff, atomic write, backup, CUDA extras |
| `apps/backend/local-stack/stack/init.ts` | CLI entry: flags, wizard, plan, disk guard, atomic write |
| `apps/backend/local-stack/stack/init.test.ts` | AC-6/7/9/11/13 tests (6) |
| `apps/backend/local-stack/stack/detect.test.ts` | AC-1/2/12 + Bun adapter contract suite |
| `apps/backend/local-stack/stack/recommend.test.ts` | AC-3/4/5 against shipped manifest |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | export local_ai schemas |
| `packages/shared/types/src/index.ts` | export local_ai types |
| `.moon/workspace.yml` | register `local-ai` project |
| `apps/backend/local-stack/package.json` | deps on local-ai/schemas/types; `init` script |
| `apps/backend/local-stack/tsconfig.json` | paths for local-ai/schemas/types |
| `apps/backend/local-stack/moon.yml` | dependsOn local-ai/schemas/types; `init` task (runInCI:false) |
| `apps/backend/local-stack/scripts/check.sh` | C-391 AC-8/AC-10 integration hooks |
| `apps/backend/local-stack/README.md` | quick-start rewritten to `bun run stack init` + backend table + what-it-does |
| `apps/frontend/docs/src/content/docs/guides/run-locally.mdx` | quick-start updated to two commands |
| `package.json` | root `stack` script |
| `bun.lock` | workspace dep links for local-ai |

### Deviations from Spec

- **Root `stack` script drives package.json directly, not `moon run`.** The
  contract Phase 4 prescribes `"stack": "bun moon run local-stack:init --"`,
  but moon 2.4.6 refuses to run `runInCI:false` tasks even for explicit
  `moon run` (verified: the pre-existing `up`, `fetch-models`, `build` tasks
  fail identically in the base repo). Kept `runInCI: false` in moon.yml per
  spec (CI exclusion) and wired the root script to
  `bun run --cwd apps/backend/local-stack init --`, matching the repo's
  existing convention for CI-excluded commands. The moon.yml `init` task
  still exists per spec. Recommend an Amendment to Phase 4 wording if
  `moon run` execution is required.
- **`TEXT_SERVER_IMAGE` for CUDA 13 hosts** is emitted into `.env` as the
  documented `server-cuda13` swap, matching C-390's README guidance (no
  separate override ships); C-390's compose.cuda.yaml is not edited.

### Test Results

- Unit (local-ai): 48/48 pass (0 failures)
- Unit (local-stack): 58/58 pass (0 failures)
- Integration (check.sh --static incl. AC-8/AC-10): 57 pass, 0 failures
- Baseline: 0 pre-existing failures in affected projects; `scripts:` project
  has pre-existing typecheck/lint failures at the base commit
  (`contract_pipeline` code in 37513488) unrelated to this contract —
  aggregate `validate()` reports `:fix`/`:typecheck` failures only from that
  untouched project.
