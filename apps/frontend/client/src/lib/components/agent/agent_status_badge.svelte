<script lang="ts">
// apps/frontend/client/src/lib/components/agent/agent_status_badge.svelte
import type { AgentRunResult } from '$types/agent_types';

type Props = {
  result: AgentRunResult;
};

const { result }: Props = $props();

const statusClass = $derived(result.success ? 'badge-success' : 'badge-error');
const statusLabel = $derived(result.success ? 'OK' : 'FAIL');
const phaseLabel = $derived(
  result.phase === 'pre' ? 'PRE' : result.phase === 'post' ? 'POST' : result.phase.toUpperCase(),
);
</script>

<div class="flex items-center justify-between gap-2 p-2 bg-base-100 rounded">
  <div class="flex items-center gap-2 min-w-0">
    <span class="badge badge-xs badge-ghost font-mono">{phaseLabel}</span>
    <span class="text-sm font-mono text-base-content truncate">{result.agentId}</span>
  </div>
  <div class="flex items-center gap-2 shrink-0">
    <span class="text-xs font-mono text-base-content/40">{result.durationMs}ms</span>
    <span class="badge badge-xs {statusClass}">{statusLabel}</span>
  </div>
</div>
