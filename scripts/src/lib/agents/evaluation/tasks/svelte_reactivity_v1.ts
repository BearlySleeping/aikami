// scripts/src/lib/agents/evaluation/tasks/svelte_reactivity_v1.ts
//
// C-480 AC-1: Svelte reactivity task. The `scripts` package has no Svelte
// compiler/runtime dependency, so this fixture cannot execute the reactive
// graph — the frozen oracle is a structural check on the runes pattern
// instead of a compiled-component test (that heavier lane belongs to the
// C-477 compiled-Svelte suite, not this small evaluation fixture).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'counter_store.svelte.ts';

const BASE_SOURCE = `// Svelte 5 runes counter store. BUG: exporting the destructured primitive
// loses reactivity for every consumer — they capture a snapshot, not a
// binding to the $state proxy.
let count = $state(0);

export const increment = (): void => {
  count += 1;
};

// Consumers do \`import { count } from './counter_store.svelte.ts'\` and see a
// frozen value, never the live one.
export { count };
`;

const acceptance = async (sandboxPath: string): Promise<AcceptanceOutcome> => {
  const content = await readFile(join(sandboxPath, TARGET), 'utf-8');

  if (!/\$state\(/.test(content)) {
    return { accepted: false, diagnostics: 'Must keep using a $state rune for the counter.' };
  }
  if (!/export\s+(const|function)\s+increment/.test(content)) {
    return { accepted: false, diagnostics: 'increment() must remain exported.' };
  }
  // The bug: a bare `export { count }` (or `export const count = ...`) hands
  // consumers a snapshot. The fix must expose a getter function or an
  // object accessor instead, so every read re-touches the rune.
  const bareExport =
    /export\s*\{\s*count\s*\}/.test(content) || /export\s+let\s+count/.test(content);
  const hasGetter =
    /export\s+const\s+getCount\s*=/.test(content) || /get\s+count\s*\(/.test(content);

  if (bareExport && !hasGetter) {
    return {
      accepted: false,
      diagnostics:
        'Still exports count by value (`export { count }` or `export let count`). ' +
        'Expose a getter (e.g. `export const getCount = () => count;` or a `get count()` accessor) so reads stay reactive.',
    };
  }
  if (!hasGetter) {
    return {
      accepted: false,
      diagnostics: 'No getter-style accessor found for the live count value.',
    };
  }
  return { accepted: true, diagnostics: '' };
};

export const task: EvalTask = {
  id: 'svelte_reactivity_v1',
  version: 1,
  category: 'svelte_reactivity',
  description:
    'Fix a Svelte 5 runes store that exports a $state value by direct binding, losing reactivity for consumers.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `${TARGET} exports the live $state counter as a plain binding, so importers see a frozen snapshot. Expose a getter (function or accessor) instead so every read stays reactive. Do not change increment()'s behavior.`,
  heldOut: false,
  acceptance,
};
