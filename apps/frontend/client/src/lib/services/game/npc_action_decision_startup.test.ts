// apps/frontend/client/src/lib/services/game/npc_action_decision_startup.test.ts
//
// The production service graph must actually BOOT (issue #381).
//
// Every other test of this service injects its capabilities, which is right for
// behaviour and useless for wiring. The native llama.cpp change added a
// constructor-time `hydrate()` that read the mode through
// `decisionBackendService` — and `decision_backend_service` imports this
// module, so the singleton below was constructed while that binding was still in
// its temporal dead zone:
//
//   ReferenceError: Cannot access 'decisionBackendService' before initialization
//     at resolveBackend  npc_action_decision_service.svelte.ts:131
//     at readMode       npc_action_decision_service.svelte.ts:144
//     at hydrate        npc_action_decision_service.svelte.ts:194
//     at NpcActionDecisionService.svelte.ts:442  (the singleton)
//
// Unit tests stayed green because none of them construct the real singleton.
// The app was blank on boot. This file closes that gap: it imports the production
// module and asserts it can be constructed and read.

import { describe, expect, test } from 'bun:test';
import { NpcActionDecisionService } from './npc_action_decision_service.svelte.ts';

describe('the decision service graph boots', () => {
  test('the production singleton constructs and answers mode() without a TDZ crash', async () => {
    // Importing is the assertion as much as calling is: this is the import that
    // used to run the failing constructor.
    const module = await import('./npc_action_decision_service.svelte.ts');

    expect(module.npcActionDecisionService).toBeDefined();
    // The call that previously threw.
    expect(() => module.npcActionDecisionService.mode()).not.toThrow();
    // Fail-closed default: no persisted mode means `off`, never `on`.
    expect(module.npcActionDecisionService.mode()).toBe('off');
    expect(() => module.npcActionDecisionService.qualification()).not.toThrow();
    expect(() => module.npcActionDecisionService.configRevision()).not.toThrow();
  });

  test('the decision backend service constructs, and owns no mode writer', async () => {
    // The mode writer used to live here, which meant this service had to import
    // the gameplay service to reach it — a static cycle, and a hard
    // bundle-budget gate. It is now an injected capability on the section.
    const backend = await import('../ai/decision_backend_service.svelte.ts');
    expect(backend.decisionBackendService).toBeDefined();
    expect('setGameplayMode' in backend.decisionBackendService).toBe(false);
  });

  test('hydrate is idempotent and a failing read leaves the service off', async () => {
    // A read that throws must not wedge the service, and must not promote it to
    // a mode nobody chose.
    const service = new NpcActionDecisionService({
      capabilities: {
        readMode: () => {
          throw new Error('config unavailable');
        },
      },
    });

    expect(service.mode()).toBe('off');
    // Second call must not re-read, and must not throw either.
    expect(service.mode()).toBe('off');
  });
});
