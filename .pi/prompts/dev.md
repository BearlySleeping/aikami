# Development Protocol

## 🔴 SESSION START — ALWAYS DO THIS FIRST

Before writing ANY code, load the `aikami-conventions` skill. This is
non-negotiable. The skill contains critical violations that break builds
if ignored (logger alias, import paths, type locations, file naming,
private member prefix).

**If you get an esbuild/module resolution error:** The fix is never to
bypass a convention. Re-read the 🔴 CRITICAL VIOLATIONS section in
`aikami-conventions` before changing any import.

### Skill Loading Order

1. Load `aikami-conventions` (always first — now includes Svelte + Backend patterns)
2. If game code: also load `pixijs-v8`
3. If Cloud Functions: also load `firestack`
4. If Tauri desktop: also load `tauri-v2`

---

## Output Style

**Terse. Technical substance only. Drop articles, filler, pleasantries.**
Fragments OK. Every word must earn its place.

- **Artifacts to files** — Never inline large generated content. Return file
  path + 1-line description.
- **Auto-expand only for**: security warnings, irreversible actions, user
  confusion.
- **After `validate()`**: 3-4 line summary — what changed, results, suggested
  commit message.

---

## Tool Selection (Mandatory)

**🔴 ALWAYS prefer Hypa-backed tools over raw equivalents.** The `bash`, `read`,
`grep`, `find`, and `ls` tools are transparently intercepted by the pi-hypa
extension which rewrites them through `hypa -c`. In the Nix environment, the
`hypa` binary is not on PATH for rewrapped commands, producing spurious
`hypa: command not found` errors. Use these instead:

| Instead of | Use |
|---|---|
| `bash` | `hypa_shell` |
| `read` | `hypa_read` |
| `grep` / `rg` via bash | `hypa_grep` |
| `find` via bash | `hypa_find` |
| `ls` via bash | `hypa_ls` |

Exception: `bash` is still fine for short commands (`git`, `mkdir`, `rm`,
`mv`, `cd`, `bun install`) where hypa's compression adds no value.

---

## Context-Mode Routing (Mandatory)

We use the Context Mode MCP to protect the context window. One unrouted command
dumps 56 KB into context.

### Think in Code

Analyze/count/filter/compare/search/parse/transform: **write code** via
`ctx_execute(language, code)`, `console.log()` only the answer. No raw data
in context.

### BLOCKED & REDIRECTED

- **Shell (>20 lines output)**: Only for `git`, `mkdir`, `rm`, `mv`, `cd`,
  `ls`, `bun install`. Use `ctx_batch_execute()` or `ctx_execute()`.
- **File reading (for analysis)**: Reading to **edit** = fine. Reading to
  **analyze/explore** = use `ctx_execute_file()`.
- **grep / search**: Use `ctx_execute(language: "shell", code: "grep ...")`.

### Parallel I/O

Multi-command research: `ctx_batch_execute()` with `concurrency`. Network/API
bounds: concurrency `4-8`. CPU bounds (build, test): concurrency `1`.

### Session Continuity

Session history is persistent. On resume, **search BEFORE asking user:**

- What did we decide? → `ctx_search(queries: ["decision"], source: "decision", sort: "timeline")`
- What constraints exist? → `ctx_search(queries: ["constraint"], source: "constraint")`

---

## Environment (Always Loaded via Direnv)

The project uses direnv to provision the entire development environment. These env vars are always available:

- `AIKAMI_MODE` — emulator (local), staging, or production
- `AIKAMI_PROJECT_ID` — resolved GCP project id
- `AIKAMI_IS_EMULATOR` — "1" when running locally

Use `direnv_status` to check the current environment. Use `direnv_switch_mode emulator` to switch to local development.

---

## Service Management

Start the Firebase emulator before coding for local backend support.

- `firebase_emulator start` — start the local Firebase emulator suite
- `firebase_emulator stop` — stop the emulator
- `firebase_emulator status` — check if emulator is running

## Flow

1. Start emulator if needed: `firebase_emulator start`
2. Write code — no lint/typecheck during dev
3. Call `validate()` — fix+typecheck on affected projects
4. If fails → fix, re-run
5. If passes → present summary, ask user: commit, commit+push, or change

## Commit & Push Policy

**Never commit or push without explicit user instruction.** Default: keep all
changes in the working tree. After `validate()` passes: present diff summary +
suggested commit message. Ask: "Commit? Commit+push? Change?" Do not push
automatically at end of a task.

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
- **NEVER** execute long-lived server commands (e.g., `vite dev`, `vite preview`, `bun run dev`, `moon run dev`) in the main execution thread. These will freeze the agent loop. If you absolutely must start a server, use the `firebase_emulator` or `tmux_session` tool to run it in the background.

## Debugging Protocol (CRITICAL)

### Anti-loop rule: 2 strikes → create a test (HARD STOP)

When ANY approach has been tried twice and failed:
1. **STOP immediately.** Do NOT attempt the same thing a third time.
2. **Audit what diagnostic data you have** — logs, status codes, error messages
3. **Create a diagnostic script** — write a temp `.ts` file, run it, capture output
4. **Present findings, not guesses** — cite specific log lines or error codes

| Situation                          | Instead of...              | Do THIS                                                             |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| "I sent /start, is it working?" ×2 | "Try sending /start again" | Create a test script that hits the webhook directly                 |
| Deploy fails twice                 | "Try deploying again"      | Read deploy logs, check moon affected, check service status         |
| Service unreachable ×2             | "Try checking"             | `service_logs` + write a health check script                        |
| Any error ×2                       | "Try again"                | Write a minimal reproduction script, run it locally, capture output |

### Always prefer local testing over production

- Cloud Functions webhook not working? → Test with emulator + curl first
- Telegram not receiving? → Send test webhook payload directly with bun, verify flow end-to-end locally

### Create diagnostic scripts — DON'T ask the user to run commands

When debugging, write a small script that gathers all the information needed.
Put it in a temp file, run it, capture output, then delete it.

```typescript
// Example: When debugging telegram webhook, create this script
// instead of asking user to "try /start again":

// Save to /tmp/debug_webhook.ts
const response = await fetch("http://localhost:5001/.../webhook_telegram", {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"x-telegram-bot-api-secret-token": TOKEN,
	},
	body: JSON.stringify({
		update_id: 1,
		message: {
			message_id: 1,
			chat: { id: 123, type: "private" },
			date: 0,
			text: "/start",
		},
	}),
});
console.log("Status:", response.status);
const logs = await response.text();
console.log("Body:", logs);
// ... check downstream logs too
```

Run with: `bun /tmp/debug_webhook.ts`

### Use ALL available diagnostic tools before guessing

Before concluding what's wrong, exhaust these in order:

1. `service_logs` — View logs for the relevant service
2. `firestore_query` — Check if data was written
3. `firebase_emulator status` — Verify emulator is running
4. Write a custom diagnostic script — Gather structured evidence
5. **LAST RESORT** — Ask user to try something manually

### Never hallucinate errors

- If you don't have log evidence of what's wrong, say "I don't have enough diagnostic data"
- Don't guess "it might be X" without log confirmation
- When logs are silent, write a script that increases logging verbosity first
- Present findings as: "The logs show X at line Y" not "I think X is happening"

### Tiered Diagnostic Escalation

| Attempt | Action |
|---------|--------|
| 1st failure | Check `service_logs`, `firestore_query`, `firebase_emulator status` |
| 2nd failure | Write diagnostic script, test locally, capture structured output |
| 3rd+ | NEVER happens — the 2-strikes rule already kicked in |

### Never Do This

- ❌ "Try sending /start again"
- ❌ "Restart the service and try again"
- ❌ "It might be X" (without log evidence)
- ❌ "Let me try one more time" after 2 failures
- ❌ "I think the issue is..." (guessing without data)

### Always Do This

- ✅ After 2 failures: write and execute a diagnostic script
- ✅ Cite specific log lines: "The log at 14:32:05 shows `error: timeout`"
- ✅ Test locally before asking user to try anything
- ✅ Say "I need more diagnostic data" when logs are silent

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
