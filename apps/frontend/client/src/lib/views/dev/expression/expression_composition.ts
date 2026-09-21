// apps/frontend/client/src/lib/views/dev/expression/expression_composition.ts
//
// Production wiring for the expression dev sandbox. This is the only module in
// the feature that imports the `$services` singletons; the ViewModel receives
// them as typed capabilities.

import type { BaseDevViewModelOptions } from '@aikami/frontend/services/base';
import { assetStore, expressionService, getExpressionAssetResolver } from '$services';
import {
  createExpressionDevViewModel,
  type ExpressionDevViewModelInterface,
} from './expression_view_model.svelte';

/**
 * Builds the expression dev sandbox ViewModel wired to the production
 * expression, resolver, and asset-store singletons.
 */
export const getExpressionDevViewModel = (
  options: BaseDevViewModelOptions,
): ExpressionDevViewModelInterface =>
  createExpressionDevViewModel({
    ...options,
    expression: expressionService,
    resolver: getExpressionAssetResolver({ className: 'DevExpressionResolver' }),
    assets: assetStore,
  });
