# Background Tasks Journal

Background commands launched by the `bg` tool are held in memory during the Pi
session. This directory is reserved for future journal persistence and is
gitignored.

## Files (Planned)

Tasks currently run in-memory with IDs like `bg1`, `bg2`, etc. The `bg` tool
provides `bg.list`, `bg.status`, and `bg.wait` to inspect running tasks within
the current session. Tasks are not persisted to disk and do not survive session
restarts.

Future journal persistence would write:

| File | Contents |
|---|---|
| `bg-<ts>-<pid>-<seq>.json` | Machine-readable snapshot of one task (schema below) |
| `bg-<ts>-<pid>-<seq>.log`  | Combined stdout+stderr of the task, streamed live as it runs |

IDs are `bg-<epoch-ms>-<pi-pid>-<seq>`, where `<seq>` is a per-process counter
or random component to prevent collisions when tasks launch within the same
millisecond.

## Planned JSON Schema (`bg-<ts>-<pid>-<seq>.json`)

```jsonc
{
  "id": "bg-1755000000000-12345-001",  // task id == file stem
  "command": "bun moon run app:build",
  "cwd": "/repo",                      // working directory the command ran in
  "pid": 9876,                         // the shell's process id (null while unknown)
  "startedAt": 1755000000000,          // epoch ms when the task started
  "finishedAt": 1755000060000,         // epoch ms when it exited (absent while running)
  "exitCode": 0,                       // null while running; signal-death reports null
  "killed": false,                     // true when the task was killed (timeout/abort/request)
  "state": "success",                  // one of running | success | failed | killed
  "updatedAt": 1755000060000           // epoch ms of the last write
}
```

`state` is derived from `exitCode`/`killed`/`running` and written on every
transition (launch → running → terminal).

## Current Usage

Tasks exist only in memory during the Pi session. Use the `bg` tool commands:

```sh
# List all running tasks in this session
bg.list

# Check status of a specific task
bg.status {id: "bg1"}

# Wait for a task to complete
bg.wait {id: "bg1"}
```

Tasks launched in one Pi session are not visible to other sessions or terminal
processes. Cross-session availability would require the planned journal
persistence described above.

## Planned Shell Usage (When Journal Persistence is Implemented)

```sh
# Watch a specific task live as it runs:
tail -f .pi/background-tasks/bg-1755000000000-12345-001.log

# See the latest snapshot of every task:
for f in .pi/background-tasks/*.json; do echo "== $f"; jq -c '{id,state,exitCode}' "$f"; done

# Peek at the end of a specific finished task:
tail -40 .pi/background-tasks/bg-1755000000000-12345-001.log
```

## Live herdr viewer (optional)

If the `herdr` CLI is on PATH, `bg.run {watch:true}` or `bg.watch` mirrors a
task's log into a real terminal pane in the `aikami-<mode>-bg` workspace running
`tail -f`. That pane is a *viewer only* — the task's exit code always comes from
the process + JSON snapshot, never from scraped pane output. Close a watcher
pane with `bg.unwatch` or `herdr pane close <pane_id>`.
