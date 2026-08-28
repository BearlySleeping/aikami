# @aikami/worker

Generic always-on background-worker host.

## Overview

Deployed to a single Compute Engine VM instead of Cloud Functions/Cloud Run,
because a persistent connection (Gateway-style, WebSocket) needs a process
that stays up — a poor fit for anything pay-per-invocation. Deliberately
**not named/scoped to Discord**: this VM's job is "run always-on background
workers." Today it starts `@aikami/backend-discord-bot`'s Gateway bot plus
its Discord Interactions Endpoint (see "HTTP surface" below), but a future
worker plugs in the same way: declare its required env keys, start it in
`src/index.ts`.

This app owns *how* env values are sourced (`src/env.ts` + `src/secrets.ts`
— GCP Secret Manager via the VM's own service-account identity, no SDK, just
the metadata server + a REST call), never *what* a given worker needs — that
lives with the worker itself (e.g.
`packages/backend/discord-bot`'s `DISCORD_BOT_REQUIRED_ENV_KEYS`).

## HTTP surface

Besides the Gateway bot, this VM also runs a small Elysia HTTP server
(`src/index.ts`):

- `GET /health` — liveness check.
- `POST /discord/interactions` — the Discord Interactions Endpoint (`/ask`),
  from `@aikami/backend-discord-bot`'s `discordInteractions` plugin. Moved
  here from a Firebase Cloud Function (`docs/contracts/C-418-p2`, OQ-3) so
  it shares a host with the Gateway bot instead of a separate deploy
  target. Rate-limited to one `/ask` per Discord user per 10s
  (`@aikami/utils`'s `tryReserve`, in-memory — fine for a single process).

Reachable at `https://worker.bearlysleeping.com`, proxied through
Cloudflare (`worker` A record → the VM's **static** external IP
`aikami-worker-ip`). This zone's Cloudflare SSL mode forwards proxied
HTTPS traffic to the origin on port 443 over real TLS — there's no free
way to remap that to a different origin port without an Origin Rule
(needs a Cloudflare token scope the `cf` OAuth session set up in
`scripts/` doesn't have). So the server terminates TLS itself on 443 using
a **Cloudflare Origin CA certificate** (`WORKER_TLS_CERT`/`WORKER_TLS_KEY`
— Secret Manager only, see `src/index.ts`'s `resolveTls()`; falls back to
plain HTTP on 8080 if absent, e.g. local dev). Binding 443 needs root,
which the container image runs as by default.

Firewall: inbound `tcp:443` (rule names still say `-http-`, a
leftover from the original 8080 plan — kept as-is rather than
delete+recreate churn) (v4: `allow-worker-http-v4`, v6:
`allow-worker-http-v6`) restricted to Cloudflare's published IP ranges
(never `0.0.0.0/0`), network tag `aikami-worker`:

```bash
gcloud compute firewall-rules create allow-worker-http-v4 \
  --project=aikami-production --network=default --direction=INGRESS \
  --action=ALLOW --rules=tcp:443 \
  --source-ranges=<cloudflare IPv4 ranges: https://www.cloudflare.com/ips-v4> \
  --target-tags=aikami-worker
# repeat as allow-worker-http-v6 with --source-ranges from ips-v6 —
# GCP rejects mixed IPv4/IPv6 ranges in a single rule.
```

The VM's external IP is **static** (`aikami-worker-ip`, reserved in
`us-central1`), not ephemeral — genuinely still free (GCP only bills a
static IP when it's *not* attached to a running instance, and this VM is
always-on), but unlike ephemeral it survives `update-container` deploys.
This matters: the ephemeral IP GCP originally assigned **changed on the
very first deploy** after this was set up, which would have silently
broken the DNS record on every future rollout — promoting it to static
(`gcloud compute addresses create aikami-worker-ip
--addresses=<current IP> --region=us-central1 --project=aikami-production`,
which reserves the IP *in place*, no change/downtime) fixes that for good.

Once `https://worker.bearlysleeping.com/health` resolves, register the
Interactions Endpoint with Discord:

```bash
bun run discord:endpoint:sync   # scripts/src/lib/discord/endpoint.ts
```

Discord PINGs the URL live as part of that call, so a success there proves
the whole chain — Cloudflare → firewall → VM → TLS → Elysia → signature
verification — actually works end to end.

## Tech Stack

- **Runtime**: Bun, bundled to a single self-contained file (`bun build
  --target=bun`) — no `bun install` or monorepo source in the deployed image.
- **Container**: `oven/bun:1-distroless` — just the bundle, nothing else.
- **Host**: Compute Engine, `e2-micro` (GCP Always Free tier — genuinely
  $0/month: free instance-hours, `pd-standard` 30GB disk, and same-region
  image pulls all within the free allowance).

## Installation

This is a workspace app managed by moon. Install dependencies:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `start` | `bun run src/index.ts` | Run locally (needs a `.env` — see below) |
| `build` | `bun run build` | Bundle `src/index.ts` → `dist/index.js` |
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Local development

Bun auto-loads `.env.{mode}` (see `.env.example` for the full key list —
`DISCORD_BOT_TOKEN`, `GITHUB_ISSUES_TOKEN`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `DISCORD_PUBLIC_KEY`). Generate one from GCP Secret
Manager with the repo's standard scripts (this app is registered in
`scripts/src/lib/deploy/deployment_config.ts`'s `APP_CONFIG` for exactly
this — `enabled: false` there just means the *generic docker-release
pipeline* skips it, not the secrets pipeline):

```bash
bun run decrypt-secrets --mode production worker   # → .env.production
bun run start
```

Without a `.env.{mode}`, `src/env.ts` falls back to fetching secrets from
Secret Manager via the GCE metadata server — that only works ON the VM
itself, so local runs always need a `.env.{mode}` (or a hand-filled `.env`).

## Deployment

```bash
bun run deploy:worker   # from repo root — scripts/src/lib/worker/deploy.ts
```

Builds the bundle, builds+pushes the Docker image to the `aikami-worker`
Artifact Registry repo (`us-central1` — same region as the VM, so pulls stay
within the Always Free tier; this is a **separate** repo from the rest of
this monorepo's `europe-west4` `aikami` repo), then runs `gcloud compute
instances update-container` to pull and restart the running container in
place. Production only — there's no staging VM (one Discord guild, no
reason to run a second bot instance against it).

The *build→push→restart* rollout above is not wired into the generic
`scripts/src/lib/deploy/` pipeline (`deployment_config.ts`'s
service-type/`gcloud run deploy` framework) — that models one-shot deploys
of stateless services/functions, a poor fit for a single persistent VM with
its own restart step. `APP_CONFIG` still lists this app (`enabled: false`,
same shape as `image`/`text`/`voice`) purely so `decrypt-secrets` /
`encrypt-secrets` manage its `.env.{mode}` files — see "Local development"
above. Secrets themselves are never passed via `--container-env` at deploy
time either way: the running container fetches them itself from Secret
Manager using the VM's own identity (`src/secrets.ts`), so nothing sensitive
ever sits in VM instance metadata.

### Infra (already provisioned in `aikami-production`)

- VM: `aikami-worker` (`us-central1-a`, `e2-micro`, Container-Optimized OS)
- Static IP: `aikami-worker-ip` (`us-central1`, `IN_USE` — free while
  attached to this always-on VM)
- Service account: `worker@aikami-production.iam.gserviceaccount.com` —
  `roles/secretmanager.secretAccessor` scoped to just the secrets it needs
  (`DISCORD_BOT_TOKEN`, `GITHUB_ISSUES_TOKEN`, `OPENROUTER_API_KEY`,
  `OPENROUTER_MODEL`, `DISCORD_PUBLIC_KEY`, `WORKER_TLS_CERT`,
  `WORKER_TLS_KEY`), `roles/artifactregistry.reader` on the
  `aikami-worker` repo
- Artifact Registry: `aikami-worker` (Docker, `us-central1`)
- Firewall: inbound `tcp:443` allowed **only** from Cloudflare's published
  IP ranges (network tag `aikami-worker`) — see "HTTP surface" above for the
  exact command. Everything else stays outbound-only (Discord Gateway,
  OpenRouter, GitHub, Secret Manager). Management SSH:

```bash
gcloud compute ssh aikami-worker --zone=us-central1-a --project=aikami-production --tunnel-through-iap
sudo docker ps
sudo docker logs $(sudo docker ps -lq)
```

Known caveat: `gcloud compute instances create-with-container` (Konlet) is
marked deprecated by Google in favor of newer container-hosting options —
fine for a small side-project VM, but worth migrating off eventually.

## Structure

```
src/
├── index.ts     # Entry point — starts whichever worker(s) this VM hosts
├── env.ts        # Generic env loader (given a list of keys)
└── secrets.ts     # GCE metadata server → Secret Manager REST fetch
```
