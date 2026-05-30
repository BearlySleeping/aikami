# Development Protocol

## Environment (Always Loaded via Direnv)

The project uses direnv to provision the entire development environment. These env vars are always available:

- `AIKAMI_MODE` — emulator (local), development (staging), or production (live)
- `AIKAMI_PROJECT_ID` — resolved GCP project id
- `AIKAMI_IS_EMULATOR` — "1" when running locally

Use `direnv_status` to check the current environment. Use `direnv_switch_mode emulator` to switch to local development.

---

## Service Management (tmux)

Start services BEFORE coding. They survive pi restarts and run in a dedicated tmux session.

- `/dev start` — start all services (emulator + pwa + ) in tmux session `aikami-dev`
- `/dev stop` — stop all services
- `/dev` — show status of all services
- `tmux_session start emulator` — start just the Firebase emulator in tmux
- `tmux_session read emulator` — capture last 100 lines of emulator output
- `tmux_session list` — list all services and their status

**Attach to view:** `tmux attach -t aikami-dev`

## Flow

1. Start services: `/dev start`
2. Write code — no lint/typecheck during dev
3. Call `validate()` — fix+typecheck on affected projects
4. If fails → fix, re-run
5. If passes → present summary, ask user: commit, commit+push, or change

## Model Modes

User switches via TUI commands: `/high`, `/default`, `/low`

- **/high** — deepseek-v4-pro (expensive, for complex work)
- **/default** — deepseek-v4-flash (default, balanced)
- **/low** — openrouter free router (cheap monkey work)

### Automatic mode suggestion

Assess every task on receive. Zero extra cost — done in-reasoning.

| Complexity                              | Signal                         | Suggestion                        |
| --------------------------------------- | ------------------------------ | --------------------------------- |
| trivial (< 5 lines, grep, simple text)  | one file, no deps              | "Low effort — `/low` if you want" |
| default (normal feature work)           | 1-3 files, standard patterns   | skip (already on default)         |
| complex (auth, refactor, multi-service) | 5+ files, cross-package, risky | "This is complex — worth `/high`" |
| critical (prod migration, security)     | destructive, irreversible      | "Strongly recommend `/high`"      |

Keep the suggestion to **one line** at the end of the response. Never block or ask permission — just inform.

After responding in **high** mode, append: "Done. Switch back: `/default`"
Keep responses terse in **low** mode — skip analysis, minimal tool calls.

If user is already on the recommended mode, say nothing about it.

## Rules

- No lint/typecheck/test during dev
- No asking about style mid-task
- Summary after validate: what changed + results + suggested commit msg
- Terse — 3-4 lines unless errors

## Debugging Protocol (CRITICAL)

### Anti-loop rule: 2 strikes → create a test

When the same thing is attempted twice and fails, STOP trying.
**Immediately pivot to gathering diagnostic data.**

| Situation | Instead of... | Do THIS |
|-----------|--------------|---------|
| "I sent /start, is it working?" ×2 | "Try sending /start again" | Create a test script that hits the webhook directly |
| Deploy fails twice | "Try deploying again" | Read deploy logs, check moon affected, check service status |
| "Is the VM up?" ×2 | "Try checking" | `service_logs` + `vm_controller_request` + write a health check script |
| Any error ×2 | "Try again" | Write a minimal reproduction script, run it locally, capture output |

### Always prefer local testing over production

- Cloud Functions webhook not working? → Test with emulator + curl first
- VM Controller unresponsive? → `tmux_session start ` + `vm_controller_request path=/health`
- Telegram not receiving? → Send test webhook payload directly with bun, verify flow end-to-end locally
- Zeroclaw not responding? → `_manage action=logs` BEFORE asking user to try again

### Create diagnostic scripts — DON'T ask the user to run commands

When debugging, write a small script that gathers all the information needed.
Put it in a temp file, run it, capture output, then delete it.

```typescript
// Example: When debugging telegram webhook, create this script
// instead of asking user to "try /start again":

// Save to /tmp/debug_webhook.ts
const response = await fetch('http://localhost:5001/.../webhook_telegram', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': TOKEN },
  body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: 'private' }, date: 0, text: '/start' } })
});
console.log('Status:', response.status);
const logs = await response.text();
console.log('Body:', logs);
// ... check downstream logs too
```

Run with: `bun /tmp/debug_webhook.ts`

### Use ALL available diagnostic tools before guessing

Before concluding what's wrong, exhaust these in order:
1. `service_logs` — View logs for the relevant service
2. `tmux_session read <service>` — Check dev service output
3. `firestore_query` — Check if data was written
4. `vm_controller_request` — Check VM health / events
5. `_manage action=logs` — Container logs
6. Write a custom diagnostic script — Gather structured evidence
7. **LAST RESORT** — Ask user to try something manually

### Never hallucinate errors

- If you don't have log evidence of what's wrong, say "I don't have enough diagnostic data"
- Don't guess "it might be X" without log confirmation
- When logs are silent, write a script that increases logging verbosity first
- Present findings as: "The logs show X at line Y" not "I think X is happening"

### Signal that you're stuck early

After 2 failed attempts at the same approach:
```
⚠️ Two attempts at [approach] have failed. Pivoting to:
[local testing | diagnostic script | log analysis | unit test]
```

After 5 total failed attempts across approaches:
```
🛑 I'm stuck. Here's what I've tried:
1. [approach 1] → [result]
2. [approach 2] → [result]
3. [approach 3] → [result]

What I need from you:
- [specific question or access needed]
```
