---
id: C-441
title: "SOPS secrets migration — retire GCP Secret Manager and the Redis env relay"
source: "user request 2026-08-25 — GCP Secret Manager is the project's most expensive service; CI/CD audit identified the relay it forces as the largest simplification available"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-25"
---

# Contract C-441: SOPS secrets migration — retire GCP Secret Manager and the Redis env relay

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-25). GCP Secret Manager is the single largest line on the project's cloud bill, and is now the *only* remaining GCP dependency in CI after the Firebase/Cloud Run decommission. |
| **Target** | `scripts/src/lib/ops/download_secrets.ts`, `upload_secrets.ts`, `env_share.ts`, `.github/workflows/release.yml` (the `prepare-secrets` job), `.github/actions/setup-environment/action.yml` (the `gcp-auth` inputs), and a new `secrets/` tree |
| **Priority** | P2 — cost and simplification, not correctness. Nothing is broken. Sequence it after the measurement in Phase 1 confirms it is worth doing at all. |
| **Dependencies** | None hard. Overlaps C-436 (Postgres decommission removes `NEON_DATABASE_URL*` from the key set) — land C-436 first if both are queued, so this contract migrates fewer keys. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — `docs/guides/CI_CD.md` and `CONTRIBUTING.md` both describe the current `download-secrets` flow and must be rewritten. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: secrets live in GCP Secret Manager across two projects (production / staging). CI reaches them through a three-hop relay:

  ```
  GCP Secret Manager → prepare-secrets job → Upstash Redis (per-run key, 4h TTL) → every downstream job
  ```

  `env_share.ts` exists solely because the repo is public, so `.env` content may not ride in downloadable workflow artifacts. Its header documents a second reason: per-job `gcloud` fetches spawned concurrent processes that collided on gcloud's token cache and failed under Windows file locking.

- **The relay is now the only thing GCP is used for in CI.** After the Firebase/Cloud Run/docker-release jobs were deleted, `prepare-secrets` is the sole remaining `gcp-auth: "true"` consumer in the release pipeline. The dependency is being maintained for one purpose.

- **Cost driver, unmeasured.** GCP Secret Manager bills per **active secret version**, not per secret. `upload_secrets.ts` adds a version on every run and nothing destroys old ones. The bill is therefore a function of upload frequency, not of secret count — which is very likely why it is the most expensive service. **This has not been measured**, and Phase 1 exists to measure it before anything is migrated.

- **The key set is smaller than it looks.** 39 distinct non-`PUBLIC_` keys across `.env.example` files, but:
  - ~12 are not secrets at all (`MODE`, `LOG_LEVEL`, `CATALOG_ORIGIN_URL`, `DIST_ORIGIN_URL`, `BETTER_AUTH_URL`, `OPENROUTER_MODEL`, `APP_ID`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, bucket names and endpoints)
  - **12 are R2 credentials** — three buckets × `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` / `TOKEN` / `ENDPOINT`. This is the single largest block and the most compressible.
  - 2 (`NEON_DATABASE_URL`, `NEON_DATABASE_URL_DIRECT`) are deleted by C-436.

- **Reproduction**:
  1. `grep -n "prepare-secrets" -A 30 .github/workflows/release.yml` — the relay.
  2. `sed -n '1,30p' scripts/src/lib/ops/env_share.ts` — the recorded rationale.
  3. `gcloud secrets list --format='value(name)' --project=<prod> | wc -l`, then sum `gcloud secrets versions list <name> --filter='state=ENABLED'` across them — the actual cost driver.

- **Existing implementation to reuse**: `download_secrets.ts` and `upload_secrets.ts` already own the round-trip and the `.env.example`-driven key discovery. Their **interface is the thing to preserve**; only the storage backend changes. `resolveSecretName` / `PROJECT_ENV_CONFIG` in `deployment_config.ts` encode per-app key mapping that stays valid.

- **Known gaps**: `--mode emulator` is already special-cased to need no GCP access at all. That path must keep working untouched — it is what lets a contributor with no credentials build and run locally.

- **Baseline tests**: `scripts/src/lib/deploy/__tests__/` covers parts of the deploy path. Before migrating, capture a full `download_secrets.ts --mode production` output (key names and value **hashes**, never values) as the fixture that proves the migration is lossless.

## User Outcome

After this contract, a **developer** runs the same one command to get a working
`.env.<mode>` locally, with no GCP account and no cloud round-trip — and **CI**
decrypts the same files directly, with no secrets service, no Redis relay, and
no 4-hour TTL window.

## Success Measures

- **Time/latency target**: `bun run download-secrets --mode production` completes in **under 2 seconds** (local decrypt, versus a network round-trip to GSM today). CI's per-job secret setup drops from a Redis fetch to a local decrypt.
- **Offline/degraded behavior**: 🔴 a developer with the age key checked out **can decrypt with no network at all**. This is a genuine improvement over the current design and fits the project's offline-first stance.
- **Production journey enabled**: the last GCP dependency leaves CI; `prepare-secrets`, `env_share.ts`, and the Upstash dependency are deleted.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Key discovery from `.env.example` | `download_secrets.ts` | **reuse** — unchanged logic |
| CLI surface (`--mode`, `--strict`, `--keys`, app positionals) | `download_secrets.ts` | **reuse** — the interface is a hard compatibility requirement |
| Secret storage backend | GCP Secret Manager via `gcloud` | **replace** — SOPS + age |
| Cross-job env sharing | `env_share.ts` + Upstash Redis | **delete** — no longer needed |
| One-time secret fetch job | `release.yml` → `prepare-secrets` | **delete** |
| GCP auth in CI | `setup-environment` → `gcp-auth`, `gcp-service-account-key` | **delete** if no consumer remains |
| Emulator fallback values | `EMULATOR_ENV_OVERRIDES` | **reuse** — untouched |
| Pre-commit safety | `scripts/src/lib/ops/pre_commit.ts` | **modify** — add a plaintext-secret guard |

## Overview

Move secret storage from GCP Secret Manager to SOPS-encrypted files committed
to the repository, encrypted to an `age` key. `download_secrets.ts` and
`upload_secrets.ts` keep their interface and change their backend.

CI then needs exactly **one** GitHub secret (`SOPS_AGE_KEY`), which collapses
the entire three-hop relay into a local decrypt. `prepare-secrets`,
`env_share.ts`, and the Upstash dependency are deleted.

This is chosen over Cloudflare Secrets Store and GitHub Environment secrets for
one concrete reason: **both are write-only**. Neither can serve
`download_secrets.ts`, and the plaintext round-trip between CI and local
development is a requirement, not a preference.

## Design Reference

- `scripts/src/lib/ops/download_secrets.ts` — the interface to preserve, including the `--mode emulator` short-circuit.
- `scripts/src/lib/ops/env_share.ts` — read its header before deleting it. It records *why* the relay exists (public repo, concurrent-gcloud Windows file locks); the replacement must not reintroduce either problem.
- `scripts/src/lib/deploy/deployment_config.ts` — `MODE_PROJECT_MAP`, `PROJECT_ENV_CONFIG`, `resolveSecretName`, `resolveEnvFile`. The mode→file mapping survives; the mode→GCP-project mapping does not.
- C-426 — specifies `wrangler secret put` for the hub's Google client secret. This contract's runtime-secret decision (Open Question 3) may supersede that; if it does, amend C-426 rather than leaving two contradictory records.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Measure before migrating.** 🔴 Phase 1 is not optional. If the GSM bill turns out to be dominated by accumulated versions, then destroying old versions and collapsing the 12 R2 credentials may cut it by most of its value with no architecture change at all. Migrating a $1.50/month service is a hobby, not a cost decision — and this contract should be closed as `superseded` if that is what the numbers say.
- **The CLI interface is frozen.** `download_secrets.ts` and `upload_secrets.ts` keep their flags, positional app arguments, output file layout, and section ordering. Every caller — `CONTRIBUTING.md`, `publish-local-stack.yml`, developer muscle memory — must keep working. Only the backend changes.
- **🔴 `TAURI_SIGNING_PRIVATE_KEY` does not go in the public repo, encrypted or not.** Every other secret has a bounded blast radius: it leaks, you rotate, you are done. The updater signing key does not — an attacker holding it can sign an update that **every installed desktop client auto-accepts and installs**, and rotating afterwards does not un-compromise machines that already pulled the signed payload. Public git history is permanent, so a key leaked years later still signs against clients trusting today's pubkey. This one key lives in a GitHub Actions secret under separate custody, with its own age recipient if it is encrypted at all.
- **Multiple age recipients from day one.** At minimum: the maintainer's key and a CI key. Single-recipient encryption means rotating CI requires re-encrypting every file and cannot be done incrementally.
- **Never write plaintext secrets to a tracked path.** The pre-commit hook must reject a commit containing an unencrypted `.env.production` / `.env.staging`. This is the one new failure mode the migration introduces and it must be blocked mechanically, not by discipline.
- **`--mode emulator` must not regress.** It currently requires no credentials whatsoever. After this contract it must still require none — not even the age key. A contributor with zero access must be able to build and run.
- **Delete the relay in the same contract, not "later".** Leaving `env_share.ts` and `prepare-secrets` in place "just in case" means two secret paths, one of them untested and slowly rotting. The deletion is the payoff; a migration that does not collect it has not finished.

## State & Data Models

Encrypted secret files, one per mode, committed to the repo:

```
secrets/
  production.enc.env
  staging.enc.env
.sops.yaml            # creation_rules: path → age recipients
.age/recipients.txt   # public keys only; private keys never committed
```

SOPS `dotenv` format keeps keys readable and values encrypted, so a diff shows
*which* secret changed without revealing anything:

```
BETTER_AUTH_SECRET=ENC[AES256_GCM,data:...,iv:...,tag:...,type:str]
OPENROUTER_API_KEY=ENC[AES256_GCM,data:...,iv:...,tag:...,type:str]
```

`.sops.yaml` maps paths to recipients:

```yaml
creation_rules:
  - path_regex: secrets/.*\.enc\.env$
    age: >-
      age1<maintainer-pubkey>,
      age1<ci-pubkey>
```

No application-level types or schemas change. The generated `.env.<mode>` files
keep their existing shape exactly.

## Quality Requirements

- **Offline/degraded mode**: 🔴 a full requirement here, not an N/A — decryption must work with no network. See Success Measures.
- **Accessibility/input**: N/A.
- **Performance budget**: see Success Measures. Local decrypt replaces a network round-trip, so this should be strictly faster; if it is not, something is wrong.
- **Security/privacy**: the central concern of this contract. Accepted, with eyes open: ciphertext and **key names** become permanently public, and key names are a free reconnaissance map of the infrastructure. Rejected as unacceptable: the Tauri signing key (see Architecture Directives). The realistic threat is key leakage, never cryptanalysis — age is X25519 + ChaCha20-Poly1305 over AES-256-GCM data, which is not brute-forceable.
- **Persistence/migration**: the migration itself is the risk. See Migration & Rollback.
- **Cancellation/retry/idempotency**: `download_secrets.ts` must stay idempotent — running it twice produces identical files. `upload_secrets.ts` must be safe to re-run without creating spurious diffs (deterministic key ordering; do not re-encrypt unchanged values, since SOPS re-encryption changes the IV and produces noisy diffs).
- **Observability**: 🔴 no logging path may ever print a decrypted value. Log key **names** and counts only. Audit the existing scripts for this while changing them — the risk goes up once decryption happens locally in CI.

## Migration & Rollback

- **Old data compatibility**: the generated `.env.<mode>` files are byte-identical in shape. Nothing downstream can tell the difference — that is the correctness criterion.
- **Migration**:
  1. Export every secret from GSM to plaintext locally (never committed, never logged).
  2. Encrypt into `secrets/<mode>.enc.env`.
  3. Diff hashes against the Phase 1 fixture — every key present, every value identical.
  4. Add `SOPS_AGE_KEY` to GitHub secrets; switch CI; run one full release in **staging**.
  5. Only then delete `prepare-secrets` and `env_share.ts`.
  6. Leave GSM populated but unused for one release cycle; destroy it afterwards.
- **Rollback**: until step 6, GSM is intact and reverting is a git revert plus re-adding `GCP_SA_KEY`. After step 6, rollback means repopulating GSM from the decrypted SOPS files — possible, but no longer cheap. **Step 6 is the point of no return; do not take it in the same PR as steps 1–5.**
- **Feature flag or kill switch**: an env var (`AIKAMI_SECRETS_BACKEND=gsm|sops`) selecting the backend during the overlap window, defaulting to `gsm` until staging has proven the new path.
- **Failure recovery**: if decryption fails in CI, the job must fail loudly with "SOPS_AGE_KEY missing or wrong recipient" — never fall through to a partially-populated `.env` file. A half-written env file that lets a deploy proceed with missing keys is the worst outcome available here.

## Scope Boundaries

- **In Scope:**
  - Phase 1 measurement of the actual GSM cost driver (this gates everything else)
  - Collapsing the 12 R2 credential entries into one scoped token, if the measurement shows it matters
  - SOPS + age backend behind the existing `download_secrets.ts` / `upload_secrets.ts` interface
  - `secrets/*.enc.env`, `.sops.yaml`, recipient management, and key-rotation documentation
  - Deleting `prepare-secrets`, `env_share.ts`, the Upstash dependency, and the `gcp-auth` inputs if unused
  - A pre-commit guard against committing plaintext secrets
  - Rewriting the secrets sections of `docs/guides/CI_CD.md` and `CONTRIBUTING.md`
- **Out of Scope:**
  - Moving the hub's **runtime** secrets to Cloudflare Secrets Store — related and worth doing, but a separate concern with a separate failure mode (see Open Question 3)
  - Deleting the GCP project itself, or the free-tier worker VM
  - Any change to which secrets exist or what they are used for
  - Rotating secret values as part of the migration — rotate before or after, never during, or a failed diff becomes unattributable
  - C-440's tooling

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** split at the flag boundary. PR 1 = measurement + R2
consolidation (may be enough on its own). PR 2 = SOPS backend behind
`AIKAMI_SECRETS_BACKEND`, both paths working. PR 3 = flip the default and
delete the relay. PR 3 must not land until a staging release has gone green on
the new path.

## Acceptance Criteria

### AC-1: The cost driver is measured before anything is migrated
**Given** the GCP projects as they stand
**When** active secret versions are counted per project
**Then** the number is recorded in this contract, alongside what the bill would be after destroying stale versions and consolidating R2 credentials — and the decision to proceed or close as `superseded` is made from that number.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Manual | version counts + projected post-cleanup bill | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: `gcloud secrets list` + per-secret `versions list --filter='state=ENABLED'`, summed per project
- E2E / Visual: N/A

**Watch Points**:
- 🔴 This AC can legitimately **end** the contract. If the answer is "$1.50/month, mostly stale versions", the honest outcome is destroying the versions and marking this `superseded`. Record that outcome rather than migrating out of momentum.

### AC-2: The round-trip is preserved byte-for-byte
**Given** the pre-migration fixture of key names and value hashes
**When** `bun run download-secrets --mode production` runs against the SOPS backend
**Then** every key is present with an identical value hash, and the generated file's section ordering and formatting are unchanged.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `scripts/src/lib/ops/__tests__/secrets_roundtrip.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/src/lib/ops/`
- Integration: hash-compare old vs new generated `.env.production`; assert identical key sets and value digests
- E2E / Visual: N/A

**Watch Points**:
- 🔴 Compare **hashes**, never values. Do not write a test fixture containing real secrets, and do not print values in assertion failure output — a failing test in a public CI log is exactly how this leaks.
- `upload_secrets.ts` round-trip too: upload then download must be a fixed point.

### AC-3: CI needs exactly one secret, and the relay is gone
**Given** the release pipeline after migration
**When** its workflow files are inspected
**Then** `prepare-secrets` and every `env_share.ts` invocation are absent, `REDIS_URL`/`REDIS_TOKEN` appear in no job, and `SOPS_AGE_KEY` is the only secret consumed for env files.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | grep output over `.github/workflows/` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: `grep -rn "env_share\|REDIS_URL\|prepare-secrets\|GCP_SA_KEY" .github/` returns nothing (or only the worker VM's unrelated usage, if any)
- E2E / Visual: N/A

**Watch Points**:
- Check whether anything *else* uses Upstash before removing the dependency — `cache.ts` references a Redis-backed deploy checksum cache, which is a different concern and must survive.
- `publish-local-stack.yml` also calls `download_secrets.ts` with `gcp-auth`. It must be migrated in the same pass or it breaks.

### AC-4: A contributor with no credentials is unaffected
**Given** a fresh clone with no age key and no cloud accounts
**When** `bun run download-secrets --mode emulator` runs
**Then** it succeeds and produces a working `.env.emulator`, exactly as before.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | test asserting emulator mode needs no key | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/src/lib/ops/`
- Integration: run in a container with no `SOPS_AGE_KEY` and no `~/.config/sops`
- E2E / Visual: N/A

**Watch Points**:
- Easy to regress by adding a top-level decrypt that runs before the emulator short-circuit. Keep the short-circuit first.

### AC-5: Plaintext secrets cannot be committed
**Given** a working tree containing an unencrypted `.env.production`
**When** a commit is attempted
**Then** the pre-commit hook rejects it, naming the offending file.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | hook rejection output | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run pre-commit`
- Integration: stage a plaintext env file and attempt a commit; confirm rejection
- E2E / Visual: N/A

**Watch Points**:
- The guard must catch a *staged* file, not only one on disk, and must also reject a `secrets/*.enc.env` that is not actually encrypted (a failed `sops -e` producing plaintext at an encrypted path is the realistic accident).

### AC-6: The Tauri signing key never enters the repo
**Given** the migrated repository
**When** `secrets/` and git history are searched
**Then** `TAURI_SIGNING_PRIVATE_KEY` appears in neither, and desktop releases still sign correctly using the GitHub Actions secret.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Manual | grep over `secrets/` + a green signed staging release | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: `git log -p -S TAURI_SIGNING_PRIVATE_KEY -- secrets/` returns nothing; run a staging desktop release and verify the updater signature
- E2E / Visual: N/A

**Watch Points**:
- 🔴 The highest-severity item in this contract. Verify by *running a signed release*, not by reading config — an unsigned or wrongly-signed build that still uploads looks like success.
- `ci_run.ts` currently picks this key up from `scripts/.env.<mode>` via `initScriptsEnv`. Changing where it comes from touches that path; confirm the client's `envPrefix: ['PUBLIC_']` still keeps it out of the frontend bundle.

## Implementation Sequence

1. **Phase 1 (Measure)**: count active GSM versions per project; compute the post-cleanup bill; decide go / no-go. Capture the key-name + value-hash fixture. **Nothing else starts until this is recorded.**
2. **Phase 2 (Reduce)**: destroy stale versions; consolidate the 12 R2 credential entries into one scoped token. Re-measure. This alone may close the contract.
3. **Phase 3 (Backend)**: implement the SOPS backend behind `AIKAMI_SECRETS_BACKEND`, defaulting to `gsm`. Prove AC-2 and AC-4 with both backends passing the same tests.
4. **Phase 4 (Prove)**: flip staging to `sops`; run a full staging release; leave it for one cycle.
5. **Phase 5 (Cut over)**: flip production; delete `prepare-secrets`, `env_share.ts`, the Upstash env-relay usage, and the `gcp-auth` inputs. Migrate `publish-local-stack.yml` in the same PR.
6. **Phase 6 (Docs + custody)**: rewrite the secrets sections of `CI_CD.md` and `CONTRIBUTING.md`; document age key custody, recipient management, and the rotation runbook.

## Edge Cases & Gotchas

- **SOPS re-encryption changes the IV**, so naively re-encrypting an unchanged file produces a full-file diff. Only re-encrypt changed values, or every `upload_secrets.ts` run becomes an unreviewable diff and the "readable diffs" benefit is lost.
- **`git config diff.sops.textconv`** gives readable diffs locally — worth setting up in the same PR, and documenting, since it is a large part of why this design is nicer than GSM.
- **The age key in CI arrives via env var.** Ensure it is never echoed — `set -x` in any surrounding shell step would print it. Audit the `run:` blocks that touch it.
- **Windows file locking was one of the original reasons for the relay.** Local decrypt should sidestep it entirely, but the desktop matrix has Windows legs — verify there rather than assuming.
- **`.env.example` remains the key manifest.** Adding a key there without adding it to `secrets/*.enc.env` must fail `--strict`, exactly as it does today with GSM.
- **Two modes, two files, one recipient set.** Do not encrypt staging to a different recipient list without a reason; divergent recipients is how a key rotation half-completes.
- **Contract C-426 says the Google client secret is a `wrangler secret`.** If Open Question 3 moves runtime secrets to Cloudflare Secrets Store, amend C-426 rather than leaving two contracts disagreeing.
- **Do not rotate values during the migration.** A hash mismatch in AC-2 must mean "the migration lost something", not "someone also rotated that key".

## Open Questions

Must be resolved before status becomes `approved`:

- **Does the Phase 1 measurement justify the migration at all?** Everything else is contingent on this.
- Do the encrypted files live in the **public** repo (accepted: permanent public ciphertext + key names) or a **private** sibling repo (two compromises required, one extra secret and a checkout step)? The user leans public; the Tauri carve-out is required either way.
- Do the hub's **runtime** secrets move to Cloudflare Secrets Store in a follow-up, or stay as `wrangler secret put` per C-426? Secrets Store is write-only, which is fine for runtime and fatal for CI — the split is real and should be recorded explicitly.
- Does `bun run deploy` locally still need `TAURI_SIGNING_PRIVATE_KEY`? If yes, its separate custody needs a documented local-fetch path; if no, GitHub Actions secret is sufficient and simpler.
- Is anything other than the env relay using Upstash? `cache.ts`'s deploy checksum cache appears to be, and must survive the deletion.

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
