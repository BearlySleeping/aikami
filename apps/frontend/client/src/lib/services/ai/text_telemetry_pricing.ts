// apps/frontend/client/src/lib/services/ai/text_telemetry_pricing.ts
import { estimateTextCostUsd } from '@aikami/constants';

/** Narrow pricing boundary shared by the telemetry buffer and isolated tests. */
export const textTelemetryPricing = { estimate: estimateTextCostUsd };
