// scripts/src/lib/agents/contract_pipeline/resume_orphaned.ts
//
// Relaunch contract runs that a herdr restart killed out from under.
//
// The herdr server owns every pipeline process: the orchestrator runs inside a
// herdr pane, and herdr's session restore brings back workspaces, tabs, panes
// and their cwd — but NOT their commands (session.json has no command field;
// panes come back as bare shells). So a server restart leaves a run with a
// complete v3 manifest on disk, a worktree still checked out, a pipeline tab
// showing nothing, and no process driving any of it.
//
// Everything needed to continue already exists: `bun run contract --resume
// <runId>` reloads the manifest, re-derives the start stage from contract
// status, and reattaches the herdr-native worktree. This module is only the
// trigger — it decides WHICH runs earned a relaunch.
//
// ── Why the obvious filter is wrong ─────────────────────────────────────────
// THIS IS THE LOAD-BEARING PART. Do not loosen it to "non-terminal + dead pid".
//
// That filter reads as correct and is catastrophic. Locks leak on every hard
// kill — acquireLock traps exit/SIGINT/SIGTERM but deliberately not SIGHUP,
// which is exactly what herdr sends its panes on shutdown — so dead locks
// accumulate for as long as the repo has been running pipelines. A scan of
// this repo on 2026-08-25 found twelve locks: three live, and NINE dead at
// `review` stage, the oldest from 2026-08-23. "Non-terminal + dead pid" would
// have relaunched all nine at once, unattended, each one re-opening a review
// session from up to two days ago.
//
// `lastUpdated` cannot fix it either: writeManifest only runs on stage
// transitions, so a run genuinely working through `implement` and a run
// nobody has touched since Tuesday look identical.
//
// The discriminator is the lock's mtime, which a live orchestrator touches
// every LOCK_HEARTBEAT_MS. A run orphaned by the restart we are reacting to
// has a heartbeat seconds old; an abandoned one has a heartbeat days old.
// Runs that fail the window are reported, never resumed — recovering them is
// a human decision, and the exact command is in the report.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOCK_HEARTBEAT_MS,
  lockHeartbeatAgeMs,
  readLockMetadata,
  readManifest,
} from './manifest_store.ts';
import { isTerminalStage, type RunManifest } from './types.ts';

const RUNS_DIR = '.pi/contract-runs';

/**
 * How stale a heartbeat may be and still count as "the restart killed this".
 *
 * Four missed beats. Generous enough to survive a loaded machine, a slow
 * manifest write, or the seconds herdr spends replaying its session; far
 * tighter than the hours or days that separate a live run from an abandoned
 * one, which is the distinction that actually matters here.
 */
export const ORPHAN_WINDOW_MS = LOCK_HEARTBEAT_MS * 4;

/**
 * Give up after this many auto-resumes of the same run.
 *
 * A run whose resume re-triggers the crash that orphaned it would otherwise
 * loop forever, and the loop spends money on every lap. herdr 0.8.2 panics on
 * a stale workspace index during exactly the kind of worktree churn a resume
 * performs (src/app/ids.rs:16), so this is a live failure mode, not a
 * hypothetical one.
 */
export const MAX_AUTO_RESUMES = 3;

/** Attempts older than this stop counting — a run that has been healthy for an hour starts fresh. */
export const RESUME_COUNTER_TTL_MS = 60 * 60 * 1000;

export type OrphanVerdict = 'resume' | 'live' | 'terminal' | 'stale' | 'exhausted' | 'no_lock';

export type OrphanCandidate = {
  runId: string;
  contractId: string;
  stage: string;
  verdict: OrphanVerdict;
  /** Heartbeat age in ms, when a lock exists. */
  heartbeatAgeMs?: number;
  autoResumes: number;
};

type ResumeCounter = { count: number; lastAt: string };

const counterPath = (options: { runId: string; cwd: string }): string =>
  join(options.cwd, RUNS_DIR, options.runId, 'auto-resume.json');

const readCounter = (options: { runId: string; cwd: string }): ResumeCounter => {
  try {
    const raw = JSON.parse(readFileSync(counterPath(options), 'utf-8')) as Partial<ResumeCounter>;
    const lastAt = typeof raw.lastAt === 'string' ? raw.lastAt : undefined;
    if (!lastAt || typeof raw.count !== 'number') {
      return { count: 0, lastAt: new Date(0).toISOString() };
    }
    // A run that has been healthy for RESUME_COUNTER_TTL_MS is not in a loop;
    // let it earn its attempts back rather than staying permanently fenced.
    if (Date.now() - new Date(lastAt).getTime() > RESUME_COUNTER_TTL_MS) {
      return { count: 0, lastAt };
    }
    return { count: raw.count, lastAt };
  } catch {
    return { count: 0, lastAt: new Date(0).toISOString() };
  }
};

const bumpCounter = (options: { runId: string; cwd: string; count: number }): void => {
  const directory = join(options.cwd, RUNS_DIR, options.runId);
  mkdirSync(directory, { recursive: true });
  const value: ResumeCounter = { count: options.count, lastAt: new Date().toISOString() };
  writeFileSync(counterPath(options), JSON.stringify(value, undefined, 2));
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Classify one run. Pure apart from reading the run directory. */
export const classifyRun = (options: {
  manifest: RunManifest;
  cwd: string;
  now?: number;
}): OrphanCandidate => {
  const { manifest, cwd } = options;
  const base = {
    runId: manifest.runId,
    contractId: manifest.contractId,
    stage: manifest.currentStage,
    autoResumes: readCounter({ runId: manifest.runId, cwd }).count,
  };

  if (isTerminalStage(manifest.currentStage)) {
    return { ...base, verdict: 'terminal' };
  }

  const lock = readLockMetadata({ contractId: manifest.contractId, cwd });
  // No lock at all means the orchestrator released it cleanly and chose to
  // stop. That is a decision, not a casualty — leave it alone.
  if (!lock || lock.runId !== manifest.runId) {
    return { ...base, verdict: 'no_lock' };
  }
  if (isProcessAlive(lock.pid)) {
    return { ...base, verdict: 'live' };
  }

  const heartbeatAgeMs = lockHeartbeatAgeMs({ contractId: manifest.contractId, cwd });
  if (heartbeatAgeMs === undefined || heartbeatAgeMs > ORPHAN_WINDOW_MS) {
    return { ...base, verdict: 'stale', heartbeatAgeMs };
  }
  if (base.autoResumes >= MAX_AUTO_RESUMES) {
    return { ...base, verdict: 'exhausted', heartbeatAgeMs };
  }
  return { ...base, verdict: 'resume', heartbeatAgeMs };
};

/** Classify every run in a repo. */
export const scanRepo = (options: { cwd: string }): OrphanCandidate[] => {
  const directory = join(options.cwd, RUNS_DIR);
  if (!existsSync(directory)) {
    return [];
  }
  const out: OrphanCandidate[] = [];
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith('run-')) {
      continue;
    }
    const manifest = readManifest({ runId: entry, cwd: options.cwd });
    if (manifest) {
      out.push(classifyRun({ manifest, cwd: options.cwd }));
    }
  }
  return out;
};

/**
 * Relaunch one run, detached.
 *
 * `detached` matters for the same reason it does in herdr/session.ts: without
 * it the child inherits this process's session and controlling terminal and
 * dies with whatever started us — which, for a systemd oneshot, is immediately
 * after we exit.
 */
const relaunch = (options: { runId: string; cwd: string }): void => {
  const child = spawn('bun', ['run', 'contract', '--resume', options.runId, '--no-attach'], {
    cwd: options.cwd,
    stdio: 'ignore',
    detached: true,
    env: process.env,
  });
  child.unref();
};

export const resumeOrphaned = async (options: {
  roots: string[];
  dryRun?: boolean;
}): Promise<number> => {
  let resumed = 0;
  for (const cwd of options.roots) {
    const candidates = scanRepo({ cwd });
    if (candidates.length === 0) {
      continue;
    }
    console.log(`\n${cwd}`);
    for (const c of candidates.sort((a, b) => a.runId.localeCompare(b.runId))) {
      // Terminal runs are the overwhelming majority and say nothing useful.
      if (c.verdict === 'terminal' || c.verdict === 'no_lock') {
        continue;
      }
      // The live branch short-circuits before reading the heartbeat — a
      // running pid is already conclusive — so don't imply we looked.
      const label =
        c.heartbeatAgeMs === undefined
          ? `${c.runId} (${c.stage})`
          : `${c.runId} (${c.stage}, heartbeat ${Math.round(c.heartbeatAgeMs / 1000)}s)`;
      switch (c.verdict) {
        case 'live':
          console.log(`  ✓ ${label} — orchestrator still running, untouched`);
          break;
        case 'stale':
          console.log(
            `  · ${label} — abandoned, not a restart casualty. ` +
              `Resume by hand: bun run contract --resume ${c.runId}`,
          );
          break;
        case 'exhausted':
          console.log(
            `  ⚠️  ${label} — ${c.autoResumes} auto-resumes already, giving up. ` +
              `Something is killing it on resume; investigate before: bun run contract --resume ${c.runId}`,
          );
          break;
        case 'resume': {
          if (options.dryRun) {
            console.log(`  → ${label} — would resume (attempt ${c.autoResumes + 1})`);
            break;
          }
          console.log(`  → ${label} — resuming (attempt ${c.autoResumes + 1})`);
          bumpCounter({ runId: c.runId, cwd, count: c.autoResumes + 1 });
          relaunch({ runId: c.runId, cwd });
          resumed++;
          // Stagger: each resume drives herdr worktree churn, and herdr 0.8.2
          // panics on concurrent workspace-list mutation. Serialising costs a
          // few seconds and removes a whole class of restart-storm.
          await new Promise((r) => setTimeout(r, 3000));
          break;
        }
        default:
          break;
      }
    }
  }
  return resumed;
};
