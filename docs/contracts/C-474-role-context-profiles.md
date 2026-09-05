---
id: C-474
title: "Load lean role contexts and resolve model configuration explicitly"
source: direct
contract_type: thin
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/255"
  pr_number: 255
created_at: "2026-09-04T22:21:38Z"
---

# Contract C-474: Load lean role contexts and resolve model configuration explicitly

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 08 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Pi resource/tool selection, pipeline role prompts and `models.ts` |
| **Type** | thin |
| **Priority** | P1 — irrelevant always-on context and implicit model assumptions waste turns |
| **Dependencies** | C-473; instruction-repair PR 02 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — role profiles, resource discovery and effective model settings |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / medium; target 8–25 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `toolsForRole` returns undefined, loading all tools; both model tiers named pro/flash resolve to Flash. Local measurement counts only project-registered tools, not the assembled global/MCP/built-in/skill surface. Twenty-six Pixi descriptions add about 3,755 approximate tokens before wrappers, even for non-engine work.
- **Reproduction:** compare writer/implementer/review resource registration and prompt construction. Inspect `.pi/settings.json`, `models.ts`, `herdr_adapter.ts`, `prompt_loader.ts`, `lib/gating.ts` and `measure_tool_surface.ts`.
- **Existing implementation to reuse:** namespaced tools, TypeBox dispatch validation, skill routers, Pi's supported resource filters/active-tool APIs, C-472 role boundaries and C-473 configuration telemetry.
- **Known gaps:** broad triggers and duplicate global/project instructions obscure the role task; configured and effective provider thinking settings may differ.
- **Baseline tests:** C-468 registration/loader suites, C-472 scenario tests, C-473 usage tests.

## User Outcome

Each worker sees the tools and instructions it needs, and the maintainer can see the exact model, reasoning setting and context profile used without changing personal global configuration.

## Scope Boundaries

- **In Scope:** small checked role-profile configuration, deterministic resource selection, router-based skill disclosure, explicit per-role model/thinking resolution, assembled-surface measurement and tests.
- **Out of Scope:** new authorization/security mechanisms (reuse C-472), OS sandboxing, provider implementation changes, changing default model based on unmeasured claims, deleting upstream documentation, global home-directory edits, auto-updates or paid benchmarks.

## Acceptance Criteria

### AC-1: Profiles retain required capabilities without unrelated surface
**Given** writer, critic, implementer, verifier and review profiles,
**When** the loader assembles a session,
**Then** each role retains completion/recovery and its required read/edit/test capabilities; only appropriate profiles expose publication tools. Browser/local-AI tools are selected by task needs, not universally required. An optional capability can be explicitly enabled before a new session/turn using supported Pi APIs, not an untyped catch-all shell substitute.
**Verification**: proposed `.pi/extensions/lib/role_profiles.test.ts` checks exact tool/resource inventories plus C-472 completion/recovery scenarios for every profile. Missing required extensions fail preflight with an actionable error; no silent fallback to all tools.

### AC-2: Specialized skills use progressive disclosure
**Given** a non-Pixi task and an engine task,
**When** skill metadata is assembled,
**Then** non-engine sessions avoid the entire Pixi API catalogue while engine sessions can discover the router and load needed specialized reference files. Project conventions remain available; upstream content is not discarded to reduce metadata.
**Verification**: inventory snapshots and fixture tasks requesting representative asset/ticker/accessibility guidance. Assert the resolver reaches the correct files without loading every body.

### AC-3: Model and thinking choices are explicit and valid
**Given** default settings, valid per-role overrides, unsupported thinking levels and unavailable model IDs,
**When** a worker/review session is prepared,
**Then** it records the requested and effective provider/model/thinking settings, rejects invalid overrides before paid work, and does not silently substitute a model or mislabel Flash as a stronger pro tier.
**Verification**: proposed pipeline model-configuration table tests using an offline provider-catalogue fixture. Test precedence once, including resumed runs and shell-safe values. Human model names in the plan are not hardcoded as provider slugs.

### AC-4: Measurement reflects the assembled surface
**Given** project/global resources, built-ins, MCP descriptors, skills and injected role instructions,
**When** the measurement command runs in an isolated fixture session,
**Then** it reports category contributions, approximate versus tokenizer-derived counts, unavailable categories and effective profile. Before/after reports demonstrate removal of unrelated surface, not just fewer local registrations.
**Verification**: measurement snapshots and C-473 configuration metadata; distinguish context size from paid uncached tokens. No credentials, live MCP side effects or model calls are needed for fixture measurements.

### AC-5: Personal configuration and startup behavior remain safe
**Given** a developer's additional global tools or a malformed profile,
**When** the project profile is selected or disabled,
**Then** global files are never rewritten, effective resource choices are inspectable, unknown required configuration fails clearly, and the ordinary non-pipeline Pi session remains usable.
**Verification**: temporary-home fixtures on Linux, Windows and macOS through C-468's tooling matrix; resolve paths without depending on the maintainer's home layout.

## Edge Cases & Gotchas

- Tool descriptions and schemas must agree; preserve namespaced parameter validation and useful error recovery.
- Context caching changes billing, not instruction consistency. Do not claim token-price savings from character counts alone.
- Configuration is local project policy, not permission to override a developer's explicit task restriction.
- Later reproducibility work in C-478 must preserve these profile choices when upstream packages are updated.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

Not executed. No implementation or platform evidence is claimed by this planning document.
