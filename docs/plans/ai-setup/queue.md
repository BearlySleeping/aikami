# Execution order

Read [README.md](README.md) first. There are exactly **four rows**, executed **strictly in order**,
each one approved contract and one PR, run with `bun run contract C-xxx` from `main`.

A dependency means the previous contract is **merged on `main`**, not merely written in another
worktree. No run may invent an API from an unmerged branch.

## Queue

| # | Contract | Delivers | Depends on | Exit evidence |
|---|---|---|---|---|
| 1 | [C-481](../../contracts/C-481-ai-configuration-convergence.md) | Canonical AI configuration, v3 migration, shared setup operations, one request resolver | — | Migration fixtures from real persisted vaults; projections agree before reload; keyless local test; text/image/TTS routing parity after reload |
| 2 | [C-482](../../contracts/C-482-managed-ai-runtime-lifecycle.md) | Redirect-safe downloads, one artifact catalog, durable cancellable jobs, owned process lifecycle | C-481 | CDN redirect succeeds and hostile hops fail; cancel stops the real transfer; external server untouched; packaged native text then offline reopen |
| 3 | [C-483](../../contracts/C-483-guided-ai-setup.md) | Reusable setup subflows, guided first-run routes, optional artwork and read-aloud | C-482 | Recommended / existing / text-only over one flow; consent before download or paid test; leave and resume backed by durable jobs |
| 4 | [C-484](../../contracts/C-484-capability-first-settings.md) | Task-first settings, capability pages, connections, local resources, programme close-out | C-483 | Deep links and pause preserved; disconnect never deletes an external model; full acceptance matrix, shims removed, docs updated |

## Why this order

- C-481 first: everything else builds against its frozen schemas, setup operations and resolver.
  Its phase 1 is the seam freeze precisely so C-482 has something stable to target.
- C-482 second: provisioning registers through C-481's canonical operations, so it cannot land first.
- C-483 third: it is presentation over both service layers, and it **owns** the shared setup subflow
  components.
- C-484 last: it mounts C-483's components unchanged and closes the programme — acceptance matrix,
  removal of C-481's temporary compatibility shims, and documentation. Nothing follows it, so those
  three must land in its PR.

The old C-483 ↔ C-484 cycle (optional modalities needing settings pages, settings pages needing
setup components) is gone: optional modalities now live inside C-483's guided flow, and C-484 only
consumes.

## Per-run rules

- **One PR per contract**, target ~50 changed files including tests, hard stop at 100. On reaching
  the cap, stop at the last complete phase in the contract's *Implementation Phases* list, leave no
  two live write paths, and report the remainder explicitly.
- **No parallel implementation lanes.** These four contracts touch overlapping files by design.
- Re-confirm each baseline premise against current `main` before editing. If a defect is already
  fixed, prove the existing behavior and report a no-op rather than manufacture a change.
- Run `moon_detect_affected` before validation, then `validate({ test: true })`. Use production-route
  POM E2E and visual evidence for changed surfaces. Mocked Tauri globals are not packaged evidence.
- Use recording or mock inference transports. No live paid API requests without separate approval.
- Escalate after two failed attempts on the same issue, a security-invariant change, or a necessary
  schema deviation.
- One newly review-ready PR at a time, targeting `main`; rebase and revalidate against accepted
  `main` before submission.
