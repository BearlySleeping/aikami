# Worker VM + Cloudflare — Gotchas & Lessons Learned

**Summary**: Standing up `apps/backend/worker`'s public HTTP surface
(`worker.bearlysleeping.com`, Elysia health check + the Discord Interactions
Endpoint) behind Cloudflare surfaced three non-obvious failures. None were
visible from reading GCP/Cloudflare docs in the abstract — each only showed
up empirically, mid-setup. See `apps/backend/worker/README.md`'s "HTTP
surface" section for the current, correct end state; this file is the
history of what broke and why, for the next time something in this chain
needs touching.

## GCE Ephemeral IPs Change on `update-container`, Not Just VM Stop/Start

**Problem**: A Cloudflare `A` record was pointed at the VM's ephemeral
external IP. The very next `bun run deploy:worker` (which runs `gcloud
compute instances update-container` — a container-level restart) silently
changed the VM's external IP. The DNS record now pointed at a dead address;
`/health` timed out with no useful error.

**Root cause**: The assumption that `update-container` only restarts the
*container*, leaving the VM (and therefore its ephemeral IP) untouched,
does not hold in practice — confirmed by directly observing the IP change
across a real deploy.

**Fix**: Promote the IP to **static** in place —
`gcloud compute addresses create aikami-worker-ip --addresses=<current IP>
--region=us-central1 --project=aikami-production` reserves the *existing*
IP without changing it or causing downtime. Verified: a second deploy after
this change left the IP unchanged.

**Cost note**: this is still genuinely free. GCP only bills a static IP
when it's `RESERVED` (reserved but *not* attached to a running resource) —
an `IN_USE` static IP on an always-on VM costs the same $0 as an ephemeral
one. The only way this VM setup could ever start being billed for the IP
is if the VM is deleted/stopped while the static address stays reserved
and unattached — don't do that without also releasing the address.

## Cloudflare's Free Tier Won't Remap the Origin Port

**Problem**: The app listened on port 8080. Discord/browsers hit
`https://worker.bearlysleeping.com` (port 443 implicit). Cloudflare's edge
TLS handshake succeeded (valid Universal SSL cert, confirmed via `openssl
s_client`), but every request timed out — eventually surfacing as a
Cloudflare `522` (with a long enough client timeout) or a bare connection
timeout (with a short one).

**Root cause**: This zone's SSL/TLS mode forwards proxied HTTPS traffic to
the **origin on port 443**, expecting real TLS there — not port 8080, and
not plain HTTP. Free-tier Cloudflare has no way to remap the origin port
per-hostname *without* an Origin Rule (Rulesets API, `http_request_origin`
phase), which needs a token scope this repo's `cf auth login` OAuth session
does not have, and which the `cf` CLI doesn't expose as a command anyway
(no `rules`/`rulesets` subcommand as of `cf` v0.6.0).

Diagnosis path that got here: `nc -l` on ports 80 and 443 on the VM while
curling through Cloudflare showed nothing arriving on *either* port at
first — that red herring turned out to be the stale-IP issue above (fixed
first). Once DNS pointed at the right IP, the same test plus a raw `curl
-v --max-time 100` (long enough to see Cloudflare's own `522` response
instead of a client-side timeout) confirmed the port-443 requirement.

**Fix**: Don't fight Cloudflare's default — make the origin serve real TLS
on 443. See the next section for how, without a publicly-trusted CA.

## Cloudflare Origin CA Certificates Need Dashboard Access, Not the OAuth CLI Session

**Problem**: `cf origin-ca-certificates create` (needed to get a
Cloudflare-trusted cert onto the origin without buying/managing a public
CA cert) returned `401 — User is not authorized to perform this action`,
despite the OAuth session having a broad scope list including
`ssl_certs:write`.

**Root cause**: The Origin CA Certificates endpoint is one of the last
Cloudflare API surfaces still tied to the legacy auth model — it accepts
either an account-level **Origin CA Key** (`X-Auth-User-Service-Key`
header, found in the dashboard under My Profile → API Tokens) or a classic
**API Token** scoped to `Zone > SSL and Certificates > Edit`. It does not
accept the kind of user OAuth bearer token `cf auth login`'s device-code
flow produces, regardless of the granted scope list. `cf auth create`
(named profiles) is also OAuth-only — there's no CLI path to paste in an
Origin CA Key or classic API Token.

**Fix**: Generate the keypair locally (`openssl ecparam -genkey -name
prime256v1 -noout` + `openssl req -new`), but get it *signed* through the
Cloudflare **dashboard**: SSL/TLS → Origin Server → Create Certificate.
Paste the resulting cert/private key straight into Secret Manager
(`WORKER_TLS_CERT`/`WORKER_TLS_KEY`) — never into a repo file, never into
`.env.example` (see that file's own comment: these are multi-line PEM
values, and this repo's `.env` pipeline only round-trips single-line
`KEY=value`, which would silently corrupt the embedded newlines).

## Granting a Secret to a Service Account Is Not Automatic

**Problem**: The worker's Gateway bot started fine (it already had access
to `DISCORD_BOT_TOKEN` etc.), but the new Interactions Endpoint crash-looped
with `Secret Manager fetch failed for "DISCORD_PUBLIC_KEY": 403` — even
though that exact secret already existed in `aikami-production` (uploaded
long ago for the old Firebase Function).

**Root cause**: `DISCORD_PUBLIC_KEY`'s IAM policy had zero bindings — the
Firebase Functions runtime SA that used to read it is not the same
identity as `worker@aikami-production.iam.gserviceaccount.com`, and moving
*code* that reads a secret does not move the IAM grant.

**Fix**: `gcloud secrets add-iam-policy-binding DISCORD_PUBLIC_KEY
--member="serviceAccount:worker@aikami-production.iam.gserviceaccount.com"
--role="roles/secretmanager.secretAccessor"`. General rule: any time a
secret gains a *new* reader (a different host/service account than
whichever one already worked), check its IAM policy explicitly — a secret
existing and being fetchable by one service account says nothing about
whether another one can read it.

## Rules Going Forward

- Never point a Cloudflare record at this VM's IP without first confirming
  it's the **static** `aikami-worker-ip`, not an ephemeral one.
- If this zone's SSL mode or the worker's listening port ever changes,
  re-verify with a long-timeout `curl` (or the `nc -l` trick) before
  assuming it "should just work" — Cloudflare's proxy behavior here isn't
  discoverable from the DNS record alone.
- Any new Secret Manager secret a service needs: explicitly grant IAM
  access to that service's exact service account, even if the secret
  already exists for another consumer.
- Origin CA certs (and anything else living on Cloudflare's legacy
  auth surface) go through the dashboard, not `cf`.
