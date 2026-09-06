---
id: C-489
title: "Restrict download redirects and verify downloader integrity"
source: "Split of C-482 into PR-sized contracts; AI setup execution plan queue row R01"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-489: Restricted redirects and downloader integrity

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-482](C-482-managed-ai-runtime-lifecycle.md) reviewed redirect policy; queue row R01 |
| **Target** | Tauri/Rust download modules under `apps/frontend/client/src-tauri/` |
| **Type** | thin |
| **Priority** | P0 — this is the security boundary for every managed download |
| **Dependencies** | C-482 (parent specification) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: model downloads need CDN redirects to succeed, but redirect handling is not expressed as a reviewed hop-by-hop policy.
- **Reproduction**: attempt a catalog download whose origin redirects to a CDN host and observe the outcome against the current policy.
- **Existing implementation to reuse**: the existing native download path and checksum verification, plus the catalog's pinned checksum and size.
- **Known gaps**: no explicit per-hop validator; no hop cap; credential-stripping across origins is not proven; path traversal in destination names is not proven safe.
- **Baseline tests**: existing Tauri download tests; record actual results before starting.

## User Outcome

After this contract, a player's model download succeeds through a legitimate CDN redirect while a hostile redirect, a traversal path or a corrupted file fails visibly instead of installing something unintended.

## Scope Boundaries

- **In Scope:** an explicit hop-by-hop redirect validator (scheme, host, port, destination class against the approved origin/CDN policy), a hop cap, credential dropping across origins, destination path validation, and checksum plus size verification anchored to the catalog.
- **Out of Scope:** enabling arbitrary redirects, the shared catalog itself (C-490), job durability (C-491), process lifecycle (C-492), and any widening of `shell` or `http` scopes to arbitrary commands or URLs.

## Acceptance Criteria

### AC-1: Permitted CDN redirects succeed
**Given** an approved origin that redirects to an approved CDN host
**When** a catalog artifact is downloaded
**Then** the download completes and verifies against the pinned checksum and size.

**Verification**: fixture redirect chains within policy; assert success and verified digest.

### AC-2: Every hop is HTTPS, including the first request
**Given** a catalog artifact URL, an approved origin configured with an `http://` scheme, and a same-origin `https → http` redirect
**When** a download or any credential-bearing request runs
**Then** it fails closed in all three cases: the approved-origin policy admits HTTPS origins only, the initial request is HTTPS or is refused before a socket opens, and a downgrade is rejected even when the host and port are unchanged.

**Verification**: assert the policy rejects an `http://` approved-origin entry; assert an `http://` artifact URL never issues a request; assert a same-origin downgrade hop fails with the same typed error as a cross-origin one. Credentials are never attached to a non-HTTPS request in any of these paths.

### AC-3: Hostile redirects fail closed
**Given** a redirect to a disallowed scheme, host, port or destination class, or a chain exceeding the hop cap
**When** the download runs
**Then** it fails visibly with a typed error and installs nothing.

**Verification**: one test per rejection class including downgrade to HTTP, unapproved host, and hop-cap exhaustion.

### AC-4: Credentials never cross an origin
**Given** a credential-bearing request that is redirected to a different origin
**When** the hop is followed
**Then** credentials and auth headers are dropped before the request is issued.

**Verification**: recording transport asserts absent auth headers on the cross-origin hop.

### AC-5: Paths and integrity are validated
**Given** an artifact name containing traversal segments, or a payload whose bytes do not match the pinned checksum or size
**When** it is written or verified
**Then** the write is refused or the artifact is rejected and removed, and a partial or interrupted download is never treated as ready.

**Verification**: traversal-name fixtures, checksum-mismatch and size-mismatch fixtures, and an interrupted-transfer case.

## Edge Cases & Gotchas

- **Policy, not toggle**: redirect handling is a reviewed policy. Do not solve a failing download by allowing arbitrary redirects.
- **Verification anchor**: a permitted CDN hop must not be able to change what is installed — verification stays anchored to the catalog's pinned checksum and size.
- **Lane boundary**: this is the Rust download lane. Do not edit client TypeScript configuration modules owned by the C-485 through C-488 lane.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
