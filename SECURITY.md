# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through
[GitHub Security Advisories](https://github.com/BearlySleeping/aikami/security/advisories/new),
which lets us discuss and fix the issue before it's public.

Expect an initial response within a few days. This is a small project — if you
haven't heard back in a week, ping in [Discord](https://discord.gg/XuuhWvSxHH)
without disclosing details.

## Scope

In scope:

- The hosted client at `aikami.bearlysleeping.com` and the hub at `hub.bearlysleeping.com`
- Auth and session handling (Better Auth, D1-backed)
- The save backup / restore path to R2
- Anything that lets one user read or modify another user's data
- Code execution via crafted content — save files, character data, mods, assets

Out of scope:

- Findings that require a compromised machine or a malicious browser extension
- Denial of service through resource exhaustion on self-hosted deployments
- Vulnerabilities in third-party AI model weights or upstream Docker images
  (report those upstream)
- Missing hardening headers with no demonstrated impact

## A note on the threat model

Aikami is **offline-first by design**. Gameplay state — campaigns, saves, chat
history — lives in a local Turso (libSQL) database on the player's device and
never requires a server. API keys entered in Settings are stored client-side
and sent only to the provider endpoint the user configured.

That means the highest-severity findings are typically:

1. Anything that exfiltrates a user's BYOK API key
2. Cross-account access in the hub (D1 / R2)
3. Code execution from imported content
