// scripts/src/lib/agents/swarm_ledger_query.ts
/**
 * Swarm Ledger Query CLI — reads the scratchpad SQLite database and
 * outputs a JSON envelope to stdout. Used by swarm_get_ledger_status.
 *
 * Usage: `bun run scripts/src/lib/agents/swarm_ledger_query.ts`
 *
 * Output (stdout):
 * ```json
 * {
 *   "activeTaskId": "C-232",
 *   "globalLockActive": true,
 *   "workerStates": [
 *     { "agentKey": "architect", "status": "working", "lastSyncTimestamp": 1783371279567, "agentOutput": "..." }
 *   ]
 * }
 * ```
 *
 * If the DB or table doesn't exist, returns a default idle envelope.
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), '.pi/swarm/agent_scratchpad.db');

// ── Default idle envelope ──────────────────────────────────

type WorkerState = {
  agentKey: string;
  status: string;
  lastSyncTimestamp: number;
  agentOutput: string;
};

type LedgerEnvelope = {
  activeTaskId: string;
  globalLockActive: boolean;
  workerStates: WorkerState[];
};

const IDLE_WORKER: WorkerState = {
  agentKey: '',
  status: 'idle',
  lastSyncTimestamp: 0,
  agentOutput: '',
};

const DEFAULT_IDLE_ENVELOPE: LedgerEnvelope = {
  activeTaskId: 'none',
  globalLockActive: false,
  workerStates: [
    { ...IDLE_WORKER, agentKey: 'architect' },
    { ...IDLE_WORKER, agentKey: 'coder' },
    { ...IDLE_WORKER, agentKey: 'qa' },
    { ...IDLE_WORKER, agentKey: 'git' },
  ],
};

// ── Main ───────────────────────────────────────────────────

const main = (): void => {
  if (!existsSync(DB_PATH)) {
    console.log(JSON.stringify(DEFAULT_IDLE_ENVELOPE));
    return;
  }

  let db: Database | undefined;

  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch {
    console.log(JSON.stringify(DEFAULT_IDLE_ENVELOPE));
    return;
  }

  try {
    const tables = db.query('SELECT name FROM sqlite_master WHERE type = ?').all('table') as Array<{
      name: string;
    }>;
    const hasHeartbeat = tables.some((t) => t.name === 'swarm_heartbeat');

    if (!hasHeartbeat) {
      console.log(JSON.stringify(DEFAULT_IDLE_ENVELOPE));
      db.close();
      return;
    }

    const rows = db
      .query(
        "SELECT task_id, agent_key, agent_status, last_heartbeat_timestamp, COALESCE(agent_output, '') as agent_output FROM swarm_heartbeat ORDER BY last_heartbeat_timestamp DESC LIMIT 20",
      )
      .all() as Array<{
      task_id: string;
      agent_key: string;
      agent_status: string;
      last_heartbeat_timestamp: number;
      agent_output: string;
    }>;

    // Build worker map from latest rows
    const workerMap: Record<string, WorkerState> = {};
    for (const r of rows) {
      if (!workerMap[r.agent_key]) {
        workerMap[r.agent_key] = {
          agentKey: r.agent_key,
          status: r.agent_status,
          lastSyncTimestamp: r.last_heartbeat_timestamp,
          agentOutput: r.agent_output || '',
        };
      }
    }

    // Fill in any missing agents
    for (const key of ['architect', 'coder', 'qa', 'git']) {
      if (!workerMap[key]) {
        workerMap[key] = { ...IDLE_WORKER, agentKey: key };
      }
    }

    const activeId = rows.length > 0 ? rows[0].task_id : 'none';
    const locked = Object.values(workerMap).some(
      (w) => w.status === 'working' || w.status === 'blocked',
    );

    console.log(
      JSON.stringify({
        activeTaskId: activeId,
        globalLockActive: locked,
        workerStates: Object.values(workerMap),
      }),
    );
  } finally {
    db.close();
  }
};

main();
