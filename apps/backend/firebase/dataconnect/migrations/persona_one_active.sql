-- apps/backend/firebase/dataconnect/migrations/persona_one_active.sql
-- At most one active persona per user, enforced by Postgres.
--
-- The Data Connect schema DSL cannot express a PARTIAL unique index
-- (CREATE UNIQUE INDEX ... WHERE ...), so the invariant is enforced with a
-- raw SQL migration. This is the concurrency backstop for the hub's
-- SetActivePersona mutation: the deactivate+activate pair is not atomic at
-- the client layer (@firebase/data-connect@0.7.3 has no transaction API), so
-- two concurrent activations would otherwise both pass the update filter and
-- leave two rows with is_active = true. With this index, the second
-- concurrent activation fails with a unique-violation conflict.
--
-- Apply to the emulator Postgres (run from apps/backend/firebase):
--   psql "$EMULATOR_DATACONNECT_URL" -f dataconnect/migrations/persona_one_active.sql
--   # EMULATOR_DATACONNECT_URL is exported by direnv; default
--   # postgresql://postgres@localhost:5432/dataconnect_emulator?sslmode=disable
--
-- The emulator Postgres persists between runs; if the schema is dropped
-- (e.g. `fdc emulator` resets the database), re-apply this file — it is
-- idempotent (IF NOT EXISTS).
--
-- Cloud SQL apply (when Data Connect is deployed outside emulator mode):
-- connect via the Cloud SQL Proxy / `gcloud sql connect`, then run the same
-- statement against the Data Connect database (fdcdb). Documented here per
-- C-374 Migration & Rollback; production enablement is tracked as an Open
-- Question (see firestack.config.ts `dataconnectDirectory`).
CREATE UNIQUE INDEX IF NOT EXISTS persona_one_active_per_user
  ON persona (uid)
  WHERE is_active = true;
