// apps/frontend/client/src/lib/data/lpc_url_config.ts
//
// 🔴 Re-export shim — URL config has moved to @aikami/frontend/preview.
// This file exists for backward compatibility during the C-445 transition.
// New code should import from '@aikami/frontend/preview' directly.

export {
  encodeLpcPreviewState as lpcStateToSearchParams,
  decodeLpcPreviewState as searchParamsToLpcState,
  createDefaultLpcPreviewState as createDefaultLpcUrlState,
} from '@aikami/frontend/preview';
export type { LpcPreviewState as LpcUrlState, LpcLayerUrlEntry } from '@aikami/frontend/preview';
