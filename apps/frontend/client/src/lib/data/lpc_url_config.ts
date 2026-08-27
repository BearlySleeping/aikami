// apps/frontend/client/src/lib/data/lpc_url_config.ts
//
// 🔴 Re-export shim — URL config has moved to @aikami/frontend/preview.
// This file exists for backward compatibility during the C-445 transition.
// New code should import from '@aikami/frontend/preview' directly.

export type { LpcLayerUrlEntry, LpcPreviewState as LpcUrlState } from '@aikami/frontend/preview';
export {
  createDefaultLpcPreviewState as createDefaultLpcUrlState,
  decodeLpcPreviewState as searchParamsToLpcState,
  encodeLpcPreviewState as lpcStateToSearchParams,
} from '@aikami/frontend/preview';
