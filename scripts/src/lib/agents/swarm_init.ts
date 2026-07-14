// scripts/src/lib/agents/swarm_init.ts
/**
 * Swarm initialization CLI.
 *
 * AC-1: Verifies the `aikami-agents` workspace exists, provisions missing
 * role tabs, maps physical PTY identifiers, and writes a confirmation log.
 *
 * Test hook: `bun run scripts -- swarm:init`
 */

import { initializeSwarm, verifyAgentMapping } from './swarm_director';

const main = async (): Promise<void> => {
  console.log('[swarm:init:starting]');

  const state = await initializeSwarm({
    projectRoot: process.cwd(),
  });

  const mapped = verifyAgentMapping(state);

  console.log('');
  console.log('══ Swarm Workspace Initialized ══');
  console.log(`  Workspace:  ${state.workspaceId ?? 'n/a'}`);
  console.log(`  All mapped: ${mapped ? '✅ yes' : '❌ no'}`);
  console.log('');

  for (const [role, agent] of Object.entries(state.agents)) {
    const icon = agent.paneId !== '' ? '✅' : '❌';
    console.log(
      `  ${icon} ${role.padEnd(10)} pane=${agent.paneId.slice(0, 8) || 'n/a'}...  tab=${agent.tabId}`,
    );
  }

  console.log('');
  console.log('Attach to workspace:');
  console.log('  herdr session attach default');
  console.log('');

  if (!mapped) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('swarm:init:failed', error);
  process.exit(1);
});
