---
name: cloudflare-ops
description: How to operate on Cloudflare account/zone resources with `cf` (pinned in scripts/package.json) — DNS records, Origin CA certificates, R2 bucket lifecycle rules, and account settings that wrangler cannot reach. Use when a task touches DNS, TLS/origin certs, R2 bucket config, or anything Cloudflare-dashboard-shaped outside of Worker deploys.
version: 1.0.0
tags: ["cloudflare", "dns", "r2", "certificates", "ops"]
---

# Cloudflare Ops — `cf` CLI

**Division of labour**: `wrangler` owns D1, R2 object access, Workers, and
deploys (`scripts/src/lib/deploy/cloudflare.ts`). `cf` owns DNS, Origin CA
certificates, R2 *bucket config* (lifecycle, CORS, custom domains), and any
other account/zone-level setting wrangler has no command for. If the task is
"deploy the hub" or "write to a bucket", that's wrangler. If it's "point a
domain at something" or "change a zone setting", that's `cf`.

Run it via `bun cf <command>` from `scripts/` — it's a devDependency there
(`"cf": "0.8.0"`), not a global install. `bun cf --help` lists top-level
commands; deeper subcommands not shown there still exist — run `bun cf
schema --list` to see every `command`/`apiPath` the installed version
supports, or `bun cf <partial path> --help` to drill in. **Only describe
what you've verified against the installed version's own output** —
capabilities vary release to release; don't assume general Cloudflare API
docs apply.

## Auth — and the wrangler gotcha

- `bun cf auth login` — OAuth device-code flow, stores a session (optionally
  under a named profile: `cf auth create <name>`, then `--profile <name>` or
  `cf auth activate <name> [dir]`). `cf auth whoami` shows current status.
- `wrangler` authenticates via `wrangler login` or the `CLOUDFLARE_API_TOKEN`
  / `CLOUDFLARE_ACCOUNT_ID` env vars — **separate** from `cf`'s OAuth session.

🔴 **Gotcha**: if `CLOUDFLARE_API_TOKEN` is set in the environment, `wrangler
dev` prefers **remote** mode over local Miniflare — even when you only meant
to run a local dev server. `scripts/src/lib/ops/run_hub_worker.ts` explicitly
blanks both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` before
spawning `wrangler dev --local`, specifically so a token sitting in a
contributor's shell can't silently point local dev at production D1/R2. Copy
that pattern anywhere you spawn `wrangler dev` from a script.

Some legacy endpoints — notably Origin CA Certificates — reject `cf`'s OAuth
bearer token outright even with the right scopes; see below.

## DNS records

Zone is resolved from `-z/--zone` (ID or domain) or `$CLOUDFLARE_ZONE_ID`.
Every mutating command supports `--dry-run` to preview without executing,
and `--body '<json>'` to bypass individual flags for complex payloads.

```bash
# List/search records in a zone
bun cf dns records list -z bearlysleeping.com --type A
bun cf dns records list -z bearlysleeping.com --name worker.bearlysleeping.com
bun cf dns records get <dns-record-id> -z bearlysleeping.com

# Edit an existing record (e.g. re-point the worker A record after a static-IP change)
bun cf dns records edit <dns-record-id> -z bearlysleeping.com \
  --body '{"type":"A","name":"worker","content":"<new-ip>","proxied":true}'

bun cf dns records create -z bearlysleeping.com --body '{...}'
bun cf dns records delete <dns-record-id> -z bearlysleeping.com --force
```

**Worked example — `worker.bearlysleeping.com`**: this A record points at
`aikami-worker-ip`, the Compute Engine VM's **static** external IP (see
`apps/backend/worker/README.md` and `docs/gotchas/worker-cloudflare-tls.md`).
Before editing this record, confirm the IP you're pointing at is the
reserved static address, not an ephemeral one picked up mid-deploy — that
exact mistake broke `/health` once already.

## Origin CA certificate (`worker.bearlysleeping.com`)

`cf origin-ca-certificates {create,get,list,delete}` exist as commands, but
**in practice they 401 against `cf auth login`'s OAuth session** — the
Origin CA endpoint is one of the legacy Cloudflare auth surfaces that only
accepts an account-level Origin CA Key or a classic API token, never an
OAuth bearer token, regardless of granted scopes. Confirmed empirically at
`cf` 0.6.0 (which also had no `rulesets` command at all); see
`docs/gotchas/worker-cloudflare-tls.md`. The alternative fix — an Origin
Rule remapping the origin port instead of terminating real TLS on the VM —
needs a token scope this repo's OAuth session doesn't have either, even now
that `cf rulesets` exists (see below).

**What actually works**: generate the keypair locally (`openssl ecparam
-genkey -name prime256v1 -noout` + `openssl req -new`), get the CSR *signed*
through the Cloudflare **dashboard** (SSL/TLS → Origin Server → Create
Certificate), then paste the resulting cert/key into Secret Manager
(`WORKER_TLS_CERT`/`WORKER_TLS_KEY`) — never into a repo file or
`.env.example` (multi-line PEM breaks this repo's single-line `KEY=value`
env pipeline). The VM terminates TLS itself on 443 using this cert; see
`apps/backend/worker/README.md`'s "HTTP surface" section.

## Rulesets (Origin Rules, WAF, etc.)

`cf rulesets` (`create`/`get`/`list`/`update`/`delete`, plus `phases` for a
zone's per-phase entry point and `rules` for individual rules within a
ruleset) is the generic entry point for anything modeled as a Cloudflare
ruleset — Origin Rules live at the `http_request_origin` phase:

```bash
bun cf rulesets phases get http_request_origin -z bearlysleeping.com
bun cf rulesets phases update http_request_origin -z bearlysleeping.com --body '{...}'
```

This exists in `cf` 0.8.0; it did not in 0.6.0 (no `rules`/`rulesets`
subcommand at all — see the gotchas doc). Re-verify the current token's
scope before relying on it in production — the worker's Origin Rule was
never applied because of a scope gap, not a missing command.

## R2 bucket config

Object read/write and bucket creation for app data go through **wrangler**
(bindings in `wrangler.jsonc`, or `wrangler r2 object put/get`). `cf r2`
covers bucket-level configuration wrangler doesn't expose:

```bash
# CORS (used by the client's offline catalog fetch — docs/guides/TAURI_BOOT_HANDOFF.md)
bun cf r2 buckets cors get aikami-catalog

# Lifecycle rules (expire/transition objects)
bun cf r2 buckets lifecycle get aikami-saves
bun cf r2 buckets lifecycle update aikami-saves --body '{"rules":[...]}'
```

## Worker custom domains — not `cf`'s job

`hub`/`client`/`site`/`docs` custom domains (`hub.bearlysleeping.com`,
`aikami.bearlysleeping.com`, …) are declared per-mode in
`scripts/src/lib/deploy/deployment_config.ts`'s `APP_CONFIG[*].cloudflare.routes`
and applied by `wrangler deploy` as part of `deployCloudflareApp()`
(`scripts/src/lib/deploy/cloudflare.ts`) — not by `cf`. Don't reach for `cf`
to add or change one of these; edit `deployment_config.ts` and redeploy.

## Guard rails

- **Destructive**: `dns records delete` (irreversible; `--force` skips the
  confirmation prompt — useful in scripts, but removes your last safety
  net), `r2 buckets delete`, `origin-ca-certificates delete` (revokes a live
  cert — an outage if it's the one terminating TLS on the worker VM),
  `rulesets delete` / `rulesets phases update` (an Origin Rule mistake can
  break traffic to a whole zone).
- **Always `--dry-run` first** on anything mutating a production zone
  (`bearlysleeping.com`) — every `create`/`update`/`edit`/`delete` above
  supports it.
- **Name the mode/zone explicitly.** Never rely on a default zone or an
  ambient `--profile`; pass `-z bearlysleeping.com` (or the staging
  equivalent) and, if multiple auth profiles exist, `--profile <name>` on
  every command that touches production. An implicit default silently
  pointed at the wrong zone is how you edit prod DNS by accident.
