# Anti-Loop Protocol

**Your job is to solve problems, not repeat failed attempts.**

## 2 Strikes Rule (HARD STOP)

When ANY approach has been tried twice and failed:
1. **STOP immediately.** Do NOT attempt the same thing a third time.
2. **Audit what diagnostic data you have** — logs, status codes, error messages
3. **Create a diagnostic script** — write a temp `.ts` file, run it, capture output
4. **Present findings, not guesses** — cite specific log lines or error codes

## Diagnostic Script Pattern

Instead of: "Can you try sending /start again?"

Do this:
```typescript
// Write to /tmp/diagnose_<issue>.ts
// Test the EXACT failure scenario locally
// Capture ALL outputs: status, body, logs, downstream effects
// Present results to user

// Then delete the script
```

## Tiered Diagnostic Escalation

| Attempt | Action |
|---------|--------|
| 1st failure | Check `service_logs`, `firestore_query`, `firebase_emulator status` |
| 2nd failure | Write diagnostic script, test locally, capture structured output |
| 3rd+ | NEVER happens — the 2-strikes rule already kicked in |

## 5th Overall Failure → Ask for Help

If after 5 TOTAL attempts across different approaches you're still stuck:
```
🛑 I'm stuck after 5 attempts:
1. [approach] → [specific result/error]
2. [approach] → [specific result/error]
...

To proceed, I need: [specific access/data/question]
```

## Never Do This

- ❌ "Try sending /start again"
- ❌ "Restart the service and try again"
- ❌ "It might be X" (without log evidence)
- ❌ "Let me try one more time" after 2 failures
- ❌ "I think the issue is..." (guessing without data)

## Always Do This

- ✅ After 2 failures: write and execute a diagnostic script
- ✅ Cite specific log lines: "The log at 14:32:05 shows `error: timeout`"
- ✅ Test locally before asking user to try anything
- ✅ Say "I need more diagnostic data" when logs are silent
- ✅ After 5 total failures: present structured summary, ask for help
