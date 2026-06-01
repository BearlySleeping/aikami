// packages/shared/schemas/src/lib/logging/log_entry.ts
import Type from 'typebox';

export const LogLevelSchema = Type.Union([
  Type.Literal('DEBUG'),
  Type.Literal('INFO'),
  Type.Literal('NOTICE'),
  Type.Literal('WARNING'),
  Type.Literal('ERROR'),
  Type.Literal('CRITICAL'),
  Type.Literal('ALERT'),
  Type.Literal('EMERGENCY'),
]);
