# Background Tasks Journal

Every background command launched by the `bg` tool writes its state here so it
stays visible **beyond the pi session that started it** — to a human `tail -f`-ing
from a terminal, to another agent, or to a headless/CI process that never touches
herdr. This directory is gitignored and regenerated on demand.

## Files

| File | Contents |
|---|---|
| `bg-<ts>-<pid>.json` | Machine-readable snapshot of one task (schema below) |
| `bg-<ts>-<pid>.log`  | Combined stdout+stderr of the task, streamed live as it runs |

Ids are `bg-<epoch-ms>-<pi-pid>`, so they never collide across sessions. Each
task owns exactly one `.json` and one `.log` sharing its id.

## JSON schema (`bg-<ts>-<pid>.json`)

```jsonc
{
  "id": "bg-1755000000000-12345",  // task id == file stem
  "command": "bun moon run app:build",
  "cwd": "/repo",                  // working directory the command ran in
  "pid": 9876,                     // the shell's process id (null while unknown)
  "startedAt": 1755000000000,      // epoch ms when the task started
  "finishedAt": 1755000060000,     // epoch ms when it exited (absent while running)
  "exitCode": 0,                   // null while running; signal-death reports null
  "killed": false,                 // true when the task was killed (timeout/abort/request)
  "state": "success",              // one of running | success | failed | killed
  "updatedAt": 1755000060000       // epoch ms of the last write
}
```

`state` is derived from `exitCode`/`killed`/`running` and written on every
transition (launch → running → terminal).

## How to consume it without the `bg` tool

```sh
# Watch a task live as it runs:
tail -f .pi/background-tasks/bg-*.log

# See the latest snapshot of every task:
for f in .pi/background-tasks/*.json; do echo "== $f"; jq -c '{id,state,exitCode}' "$f"; done

# Peek at the end of a finished task:
tail -40 .pi/background-tasks/bg-*.log
```

The `bg` tool itself (`bg.list`, `bg.status`, `bg.wait`) reads this journal, so
a task launched by another session shows up here and can be inspected or waited
on even though no live handle exists in the current process. Waiting on a
foreign task polls the JSON snapshot rather than a process handle.

## Live herdr viewer (optional)

If the `herdr` CLI is on PATH, `bg.run {watch:true}` or `bg.watch` mirrors a
task's log into a real terminal pane in the `aikami-<mode>-bg` workspace running
`tail -f`. That pane is a *viewer only* — the task's exit code always comes from
the process + JSON snapshot, never from scraped pane output. Close a watcher
pane with `bg.unwatch` or `herdr pane close <pane_id>`.
