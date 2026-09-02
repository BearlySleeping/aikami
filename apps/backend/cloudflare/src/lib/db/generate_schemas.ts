// apps/backend/cloudflare/src/lib/db/generate_schemas.ts
//
// C-461: Generator that reads Drizzle table metadata from
// `@aikami/backend-database` and emits one TypeBox 1.x row schema per table
// into `packages/shared/schemas/src/lib/db/`.
//
// Usage:
//   bun run apps/backend/cloudflare/src/cli.ts db generate          # write
//   bun run apps/backend/cloudflare/src/cli.ts db generate --check  # diff only

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  accountBackups,
  accounts,
  deviceCodes,
  packs,
  packVersions,
  sessions,
  users,
  verifications,
} from '@aikami/backend-database';

// ── Registry of tables to generate ───────────────────────────────────────
// Maps export-name → table object.  Add new tables here.
const TABLES: Record<string, object> = {
  users,
  sessions,
  accounts,
  verifications,
  deviceCodes,
  packs,
  packVersions,
  accountBackups,
} as const;

/** The output directory for generated schemas, relative to the monorepo root. */
const OUT_DIR = 'packages/shared/schemas/src/lib/db';

/** Resolved absolute output directory. */
const ROOT = resolve(import.meta.dir, '../../../../../..');
const OUT_ABS = join(ROOT, OUT_DIR);

// ── Type helpers for enum-narrowed text columns ─────────────────────────
/** Known enum arrays, keyed by `${tableExportName}.${columnKey}`. */
const ENUM_COLUMNS: Record<string, readonly string[]> = {
  'packs.visibility': ['draft', 'public', 'unlisted', 'removed'],
} as const;

// ── Column → TypeBox type string ─────────────────────────────────────────

/** Shape of a Drizzle column object as seen at runtime. */
type ColumnMeta = {
  dataType: string;
  notNull: boolean;
  constructor: { name: string };
  name: string;
};

/**
 * Maps a Drizzle column to the TypeBox 1.x type expression string.
 *
 * Column properties used:
 *   - `dataType` — 'string', 'number', 'boolean', or 'date'
 *   - `notNull` — whether the column is NOT NULL
 *   - `constructor.name` — 'SQLiteText', 'SQLiteBoolean', 'SQLiteTimestamp', etc.
 *   - `name` — the SQL column name (for documentation comments)
 */
const columnToTypeExpr = (colKey: string, tableName: string, col: ColumnMeta): string => {
  const enumKey = `${tableName}.${colKey}`;
  const enumValues = ENUM_COLUMNS[enumKey];

  let baseType: string;

  if (enumValues && col.dataType === 'string') {
    // Narrowed text column — Type.Union of literal values
    const literals = enumValues.map((v) => `Type.Literal(${JSON.stringify(v)})`).join(', ');
    baseType = `Type.Union([${literals}])`;
  } else {
    switch (col.dataType) {
      case 'string':
        baseType = 'Type.String()';
        break;
      case 'number':
        baseType = 'Type.Number()';
        break;
      case 'boolean':
        baseType = 'Type.Boolean()';
        break;
      case 'date':
        // TypeBox 1.x has no Type.Date(); use Unsafe<Date> for timestamp columns.
        baseType = "Type.Unsafe<Date>({ type: 'Date' })";
        break;
      default:
        baseType = 'Type.Unknown()';
    }
  }

  return col.notNull ? baseType : `Type.Union([${baseType}, Type.Null()])`;
};

// ── Code generation ──────────────────────────────────────────────────────

/** Convert a camelCase export name to snake_case file name. */
const toSnakeCase = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Capitalize first letter of a string. */
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Derive the TypeScript type name from a table export name.
 * E.g. `users` → `UserRow`, `deviceCodes` → `DeviceCodeRow`,
 * `packVersions` → `PackVersionRow`, `accountBackups` → `AccountBackupRow`.
 */
const rowTypeName = (tableName: string): string => {
  // Remove trailing 's' to get singular
  const singular = tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;
  return `${capitalize(singular)}Row`;
};

/**
 * Generate the TypeScript source for one row schema file.
 */
const getDrizzleTableName = (table: object): string =>
  (table as Record<symbol, string>)[Symbol.for('drizzle:Name')];

const generateSchemaFile = (tableName: string, table: object): string => {
  const dbTableName = getDrizzleTableName(table);
  const lines: string[] = [
    `// packages/shared/schemas/src/lib/db/${toSnakeCase(tableName)}.ts`,
    '//',
    `// C-461: Auto-generated TypeBox row schema for the \`${tableName}\` Drizzle table.`,
    '// Do not edit by hand — run `bun db generate` to regenerate.',
    '//',
    '',
    "import { type Static, Type } from 'typebox';",
    '',
    `/** Row shape for the \\\`${dbTableName}\\\` table (\\\`${tableName}\\\` export). */`,
    `export const ${tableName}RowSchema = Type.Object({`,
  ];

  // Columns are direct properties of the table object
  const cols = Object.entries(table).filter(
    ([, v]) => v && typeof v === 'object' && 'dataType' in v,
  );

  for (const [key, col] of cols) {
    const colObj = col as ColumnMeta;
    const typeExpr = columnToTypeExpr(key, tableName, colObj);
    const dbName = colObj.name;
    const comment = dbName !== key ? ` // column: \`${dbName}\`` : '';
    lines.push(`  ${key}: ${typeExpr},${comment}`);
  }

  lines.push('});');
  lines.push('');
  lines.push(`export type ${rowTypeName(tableName)} = Static<typeof ${tableName}RowSchema>;`);
  lines.push('');

  return lines.join('\n');
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');

  if (isCheck) {
    console.log('Checking generated row schemas are up to date…');
  }

  // Build output for each table
  const generated = new Map<string, string>();

  for (const [name, table] of Object.entries(TABLES)) {
    const content = generateSchemaFile(name, table);
    generated.set(name, content);
  }

  // Validate that every table is represented
  const expectedCount = Object.keys(TABLES).length;
  if (generated.size !== expectedCount) {
    process.exit(1);
  }

  if (isCheck) {
    // Read committed files and diff
    let hasDiff = false;
    for (const [name, content] of generated) {
      const filePath = join(OUT_ABS, `${toSnakeCase(name)}.ts`);
      if (!existsSync(filePath)) {
        console.error(`MISSING: ${filePath} \u2014 run \`bun db generate\` to create it`);
        hasDiff = true;
        continue;
      }
      const existing = readFileSync(filePath, 'utf8');
      if (existing !== content) {
        console.error(`STALE: ${filePath} \u2014 run \`bun db generate\` to regenerate it`);
        hasDiff = true;
      }
    }

    if (hasDiff) {
      console.error('\n\u274c Some generated schemas are stale. Run `bun db generate` to fix.');
      process.exit(1);
    }
    console.log('\u2705 All generated row schemas are up to date.');
  } else {
    // Write output files
    mkdirSync(OUT_ABS, { recursive: true });
    for (const [name, content] of generated) {
      const filePath = join(OUT_ABS, `${toSnakeCase(name)}.ts`);
      writeFileSync(filePath, content, 'utf8');
      console.log(`  Wrote ${relative(ROOT, filePath)}`);
    }
  }
};

await main();
