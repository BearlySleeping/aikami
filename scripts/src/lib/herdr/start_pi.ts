#!/usr/bin/env bun
// scripts/src/lib/herdr/start_pi.ts
// Start pi in its own herdr workspace (aikami-pi), separate from dev services.
//
// Usage:
//   bun herdr:pi                    # start pi in aikami-pi workspace
//   bun herdr:pi --join             # start + attach

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { spawn } from 'node:child_process';
import {
  ensureServer,
  findWorkspace,
  getWorkspaceTabNames,
  herdr,
  herdrJson,
  wrapCommand,
} from './session.ts';

// ── Types ──────────────────────────────────────────────────

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type TabCreateResult = {
  result: {
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

// ── Constants ──────────────────────────────────────────────

const PI_WORKSPACE = 'aikami-pi';
const PI_TAB = 'pi';
const PI_COMMAND = 'pi';

// ── Helpers ────────────────────────────────────────────────

const ok = (m: string) => console.log(`  ✓ ${m}`);

// ── Main ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const doJoin = args.includes('--join') || args.includes('-j');

await ensureServer();

let wsId: string | null = null;
const existingWsId = await findWorkspace(PI_WORKSPACE);

if (existingWsId) {
  wsId = existingWsId;
  const tabNames = await getWorkspaceTabNames(existingWsId);

  if (tabNames.includes(PI_TAB)) {
    console.log(`✓ pi is already running in ${PI_WORKSPACE}`);
  } else {
    // Add pi tab to existing workspace
    console.log(`📎 Adding pi tab to existing ${PI_WORKSPACE} workspace…`);
    const tabR = await herdrJson<TabCreateResult>([
      'tab',
      'create',
      '--workspace',
      existingWsId,
      '--cwd',
      process.cwd(),
      '--label',
      PI_TAB,
      '--no-focus',
    ]);

    if (tabR?.result) {
      await herdr(['pane', 'run', tabR.result.root_pane.pane_id, wrapCommand(PI_COMMAND)]);
      ok(`pi tab added to ${PI_WORKSPACE}`);
    } else {
      console.error('❌ Failed to create pi tab');
      process.exit(1);
    }
  }
} else {
  // Create new workspace
  console.log(`🚀 Creating ${PI_WORKSPACE} workspace…`);
  const createR = await herdrJson<WorkspaceCreateResult>([
    'workspace',
    'create',
    '--cwd',
    process.cwd(),
    '--label',
    PI_WORKSPACE,
    '--no-focus',
  ]);

  if (!createR?.result) {
    console.error(`❌ Failed to create ${PI_WORKSPACE} workspace`);
    process.exit(1);
  }

  wsId = createR.result.workspace.workspace_id;
  const rootPaneId = createR.result.root_pane.pane_id;
  await herdr(['tab', 'rename', `${wsId}:1`, PI_TAB]);
  await herdr(['pane', 'run', rootPaneId, wrapCommand(PI_COMMAND)]);
  ok(`pi running in ${PI_WORKSPACE}`);
}

// ── Attach if requested ────────────────────────────────────
if (doJoin) {
  // Focus the pi workspace so herdr session attach shows it instead of a different workspace
  if (wsId) {
    await herdr(['workspace', 'focus', wsId]);
  }
  console.log(`🖥  Attaching to ${PI_WORKSPACE}…`);
  const proc = spawn('herdr', ['session', 'attach', 'default'], { stdio: 'inherit' });
  await new Promise<number>((resolveJ) => proc.on('exit', resolveJ));
} else {
  console.log(`\n✓ ${PI_WORKSPACE} ready (attach: herdr session attach default)`);
}
