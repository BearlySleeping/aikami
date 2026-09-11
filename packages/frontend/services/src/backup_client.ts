// packages/frontend/services/src/backup_client.ts
//
// Narrow, import-safe public entrypoint for the hub save-backup client.
//
// The package root (`@aikami/frontend/services`) aggregates router, dialog,
// R2 and preference modules as side effects. Consumers that only need
// `createBackupClient`/`BackupEntry` import this subpath so no application
// graph is loaded. Test path aliases mirror `./base` and `./r2_storage`.

export * from './lib/services/backup_client.ts';
