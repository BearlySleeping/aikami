// apps/frontend/client/src/lib/views/settings/export/export_composition.ts
//
// Production wiring for the Export & Data settings ViewModel. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives its collaborators as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { exportService, readAiPrivacySettings, writeAiPrivacySettings } from '$services';
import { createExportViewModel, type ExportViewModelInterface } from './export_view_model.svelte';

/**
 * Builds the export ViewModel wired to the production export service and
 * privacy-settings persistence.
 */
export const getExportViewModel = (options: BaseViewModelOptions): ExportViewModelInterface =>
  createExportViewModel({
    ...options,
    service: exportService,
    privacy: { read: readAiPrivacySettings, write: writeAiPrivacySettings },
  });
