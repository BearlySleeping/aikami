// apps/backend/firebase/src/logger.ts
// Functions-specific logger — resolves $logger alias for Firebase Functions.
// See .pi/skills/aikami-conventions/SKILL.md for $logger resolution rules.
//
// This file IS the logger for this environment. It imports from the shared
// logger package as a bridge; consumers always use `import { logger } from '$logger'`.
import { logger } from '@aikami/logger';

export { logger };
