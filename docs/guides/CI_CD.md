# CI/CD

All automation lives in `.github/workflows/`. There is no Cloud Build pipeline
any more — `cloudbuild.yaml` is retired.

---

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `pr-checks.yml` | Pull request + workflow_dispatch | Runs `moon ci` against the base branch — lint, format, typecheck, and unit tests for everything the diff affects. Never deploys. Heavy suites (Tauri build, E2E) excluded by default; opt in via `workflow_dispatch` with `include-heavy=true`. |
| `release.yml` | GitHub release published, or manual | The deploy pipeline. Builds and ships every app to its target. |
| `publish-local-stack.yml` | Manual | Builds and pushes the local-stack Docker engine images. |
| `update-compose-digests.yml` | Manual / scheduled | Pins `compose.yaml` image references to content digests. |
| `discord_dev_notify.yml` | PR / issue events | Posts activity to Discord. |

---

## PR checks

The `pr-checks.yml` workflow runs on every pull request targeting `main`. It
uses `moon ci --affected` to detect which projects the diff touches and runs
only lint, format, typecheck, and unit tests for those projects. This keeps
the default check cheap — typically under 10 minutes.

The job:

1. Checks out with full history (moon needs it to diff against the base)
2. Installs Bun 1.3.13 and restores the Bun + Moon caches
3. `bun install --frozen-lockfile`
4. `bun moon ci --base=origin/<base-branch>` with `MOON_TOOLCHAIN_FORCE_GLOBALS=true`

Moon's affected-project detection means a docs-only PR does almost nothing and
a change to `packages/shared/types` rebuilds most of the repo.

### What is excluded from the default check

The following expensive suites are excluded from the default `moon ci` graph
via `runInCI: false` in their respective `moon.yml` files:

| Suite | Reason | Where it still runs |
| --- | --- | --- |
| `client:tauri-build` | Compiles Rust + full desktop bundle — very expensive | `release.yml` (deploy pipeline) |
| `e2e:*` (all E2E tasks) | Needs Playwright browsers + running dev server — slow and flaky under cold cache | On demand via opt-in |

### Running heavy suites on demand

Maintainers can trigger the full suite (including Tauri build and E2E tests)
against any branch via GitHub's **Actions → PR Checks → Run workflow** with
`include-heavy` set to `true`. The workflow runs the default check first, then
the heavy suites as additional steps.

This is useful for:
- A PR that changes Rust code in `src-tauri/`
- A PR that modifies game engine logic and needs E2E validation
- A release preparation branch

---

## Release pipeline

`release.yml` is the single deploy path. It fans out by **service type**, which
each app declares in `scripts/src/lib/deploy/deployment_config.ts`:

| Service type | Target | Apps |
| --- | --- | --- |
| `cloudflare-worker` | Cloudflare Workers | client, hub, site, docs |
| `tauri-release` | GitHub Releases | client desktop (Windows/macOS/Linux) |
| `docker-release` | Artifact Registry | text, image, voice, worker |
| `database-migration` | D1 migrations | database |

Key jobs, in order:

- `resolve-plan` — decides what this release actually needs to deploy
- `prepare-secrets` — pulls the deploy-time secret set from GCP Secret Manager
- `plan-desktop` / `plan-matrix` — expands the per-platform build matrix
- `build-web` — builds the web apps once, shared by the deploy jobs
- `deploy-cloudflare` — `wrangler deploy` per Worker, with D1/R2 bindings
- `deploy-desktop` — Tauri builds per platform, uploaded to the release
- `deploy-docker-release` — engine images to Artifact Registry
- `deploy-database-migration` — applies pending D1 migrations
- `update-manifest` / `notify-discord` — publish the update manifest, announce

> Some legacy jobs (`deploy-cloud-run-sveltekit`, `deploy-firebase-functions`)
> still exist in the file but no app maps to them any more — the hub moved to a
> Worker and Cloud Functions were removed. They're removed in **C-436**.

---

## Deploying by hand

```bash
bun run deploy                      # interactive
bun run deploy --mode=staging       # a specific mode
bun run deploy --mode=staging --dry-run
```

The script is the same `scripts/src/lib/deploy/` code the workflow calls, so
local and CI deploys cannot drift.

---

## Secrets

Deploy-time secrets live in **GCP Secret Manager** and are pulled by
`prepare-secrets`. The mapping from env key to secret name is in
`scripts/src/lib/deploy/deployment_config.ts`.

```bash
bun run download-secrets --mode staging      # needs gcloud auth
bun run upload-secrets --mode staging
```

**Contributors never need any of this.** `bun run setup:env` generates a working
local env with no cloud access at all.

Cloudflare API tokens for `wrangler deploy` are stored as GitHub Actions
secrets on the repository.
