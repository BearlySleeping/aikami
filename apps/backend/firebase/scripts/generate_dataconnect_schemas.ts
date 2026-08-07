// apps/backend/firebase/scripts/generate_dataconnect_schemas.ts
//
// Generates TypeBox schemas from the SQL Connect (Data Connect) schema.
//
// Reads:   apps/backend/firebase/dataconnect/schema/schema.gql
// Writes:  packages/shared/schemas/src/lib/generated-dataconnect/
//
// Run:
//   bun run generate:dataconnect-schemas   (from apps/backend/firebase)
//   bun moon run firebase:generate-dataconnect-schemas
//
// Output contract:
//   - One file per @table type: <snake_case_table>.ts exporting
//     `<Table>RowSchema` / `<Table>RowData` / `<Table>Row` (row = a table
//     row returned by a Data Connect query/mutation). The `Row` suffix keeps
//     the barrel exports distinct from the Firestore-shaped schemas in
//     `packages/shared/schemas/src/lib/firestore/`.
//   - `enums.ts` with named enum schemas (`VisibilitySchema`, …). NOT
//     re-exported from the barrel — table schemas inline enum unions so they
//     stay self-contained; import enums.ts directly when needed.
//   - `index.ts` re-exporting every table schema file (no enums.ts).
//
// Scalar mapping (mirrors the generated Data Connect SDK type aliases):
//   String → Type.String                 Int → Type.Number
//   Boolean → Type.Boolean               Timestamp → Type.String({format:'date-time'})
//   Date → Type.String({format:'date'})  UUID → Type.String({format:'uuid'})
//   Any → Type.Unknown()                 Enum → Type.Union([Type.Literal(…)])
//   `!`  → required field; otherwise wrapped in Type.Optional.
//
// Relations (@ref) are deliberately NOT emitted as fields — the scalar FK
// column (uid / npcId / chatId) stays, per the documented pattern in
// schema.gql and schema-refactor-decisions.md §4. A comment records the
// dropped relation.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Entry resolution — works when run from anywhere in the repo
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const SCHEMA_GQL = resolve(REPO_ROOT, 'apps/backend/firebase/dataconnect/schema/schema.gql');
const OUT_DIR = resolve(REPO_ROOT, 'packages/shared/schemas/src/lib/generated-dataconnect');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnumDef = { name: string; values: string[] };
type FieldDef = {
  name: string;
  type: string; // scalar, enum, or table (relation)
  required: boolean;
  description?: string;
  isRelation: boolean;
};
type TableDef = {
  name: string;
  snake: string;
  fields: FieldDef[];
  description?: string;
};

// ---------------------------------------------------------------------------
// Comment stripping — line-aligned: every comment line becomes an empty line
// so code line numbers are preserved, and the accumulated comment text is
// attached to the NEXT non-blank code line (declaration).
// ---------------------------------------------------------------------------

const stripComments = (source: string): { code: string; docs: Map<number, string> } => {
  const docs = new Map<number, string>();
  const lines = source.split('\n');
  const out: string[] = [];
  const pending: string[] = [];

  const flush = (lineIndex: number) => {
    if (pending.length > 0) {
      docs.set(lineIndex, cleanDoc(pending.join(' ')));
      pending.length = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? '';
    const trimmed = line.trim();

    // Block comment """ ... """ (may span lines) — accumulate into pending.
    if (trimmed.startsWith('"""')) {
      const body = trimmed.slice(3);
      if (body.endsWith('"""')) {
        pending.push(body.slice(0, -3));
        out.push('');
        continue;
      }
      pending.push(body);
      out.push('');
      while (i + 1 < lines.length && !(lines[i + 1] ?? '').includes('"""')) {
        i++;
        pending.push(lines[i] ?? '');
        out.push('');
      }
      i++;
      pending.push((lines[i] ?? '').replace('"""', '').trimEnd());
      out.push('');
      continue;
    }

    // Blank line — comments above it do NOT attach to the declaration below.
    if (trimmed === '') {
      pending.length = 0;
      out.push('');
      continue;
    }

    // Single-line # comment — accumulate.
    if (trimmed.startsWith('#')) {
      pending.push(trimmed.slice(1));
      out.push('');
      continue;
    }

    // Code line — strip a trailing # comment, attach accumulated docs.
    const hashIdx = line.indexOf('#');
    if (hashIdx !== -1) {
      const comment = line.slice(hashIdx + 1).trim();
      if (comment) {
        pending.push(comment);
      }
      line = line.slice(0, hashIdx).trimEnd();
    }
    flush(i);
    out.push(line);
  }

  return { code: out.join('\n'), docs };
};

const cleanDoc = (raw: string): string => {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const parse = (source: string): { enums: EnumDef[]; tables: TableDef[] } => {
  const { code, docs } = stripComments(source);
  const lines = code.split('\n');
  const enums: EnumDef[] = [];
  const tables: TableDef[] = [];
  const enumNames = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed.startsWith('enum ')) {
      const name = trimmed
        .slice(5)
        .replace(/\s*\{.*/, '')
        .trim();
      const values: string[] = [];
      i++;
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim();
        if (t.startsWith('}')) {
          break;
        }
        if (t && !t.startsWith('#')) {
          values.push(t);
        }
        i++;
      }
      enums.push({ name, values });
      enumNames.add(name);
    } else if (trimmed.startsWith('type ') && trimmed.includes('@table')) {
      const header = trimmed.slice(5);
      const name = (header.split(/\s|@/)[0] ?? '').trim();
      const fields: FieldDef[] = [];
      i++;
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim();
        if (t.startsWith('}')) {
          break;
        }
        if (t && !t.startsWith('@')) {
          const field = parseField(
            t,
            docs.get(i),
            tables.map((tbl) => tbl.name),
          );
          if (field) {
            fields.push(field);
          }
        }
        i++;
      }
      tables.push({
        name,
        snake: toSnake(name),
        fields,
        description: docs.get(i),
      });
    }
    i++;
  }

  return { enums, tables };
};

const SCALARS: Record<string, string> = {
  String: 'Type.String()',
  Int: 'Type.Number()',
  Boolean: 'Type.Boolean()',
  Timestamp: `Type.String({ format: 'date-time' })`,
  Date: `Type.String({ format: 'date' })`,
  UUID: `Type.String({ format: 'uuid' })`,
  Any: 'Type.Unknown()',
};

const parseField = (
  line: string,
  description: string | undefined,
  tableNames: string[],
): FieldDef | null => {
  const match = line.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*:\s*([a-zA-Z][a-zA-Z0-9]*)(!?)/);
  if (!match) {
    return null;
  }
  const name = match[1];
  const rawType = match[2] ?? '';
  const bang = match[3];
  return {
    name,
    type: rawType,
    required: bang === '!',
    description,
    isRelation: tableNames.includes(rawType),
  };
};

const toSnake = (pascal: string): string =>
  pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const GENERATED_HEADER = (source: string) => `// GENERATED FILE — do not edit by hand.
// Source: ${source}
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas
`;

const emitField = (
  field: FieldDef,
  enumValues: Map<string, string[]>,
): { line?: string; note?: string } => {
  // Relations (@ref) are intentionally dropped — the scalar FK column
  // (uid / npcId / chatId) below is the row-level representation.
  if (field.isRelation) {
    return {
      note: `// Relation '${field.name}' → ${field.type} is not part of the row schema; the FK column below stays.`,
    };
  }

  const description = field.description
    ? `description: ${JSON.stringify(field.description)}`
    : undefined;

  let typeExpr: string;
  const scalar = SCALARS[field.type];
  if (scalar) {
    if (!description) {
      typeExpr = scalar;
    } else if (scalar === 'Type.String()') {
      typeExpr = `Type.String({ ${description} })`;
    } else if (scalar.endsWith('()')) {
      typeExpr = `${scalar.slice(0, -2)}({ ${description} })`;
    } else {
      // Type.String({ format: 'date-time' }) → append the description option.
      typeExpr = scalar.replace(/\s*\}\)$/, `, ${description} })`);
    }
  } else if (enumValues.has(field.type)) {
    const values = enumValues.get(field.type) ?? [];
    const literals = values.map((v) => `Type.Literal('${v}')`).join(', ');
    const union = `Type.Union([${literals}])`;
    typeExpr = description ? `Type.Union([${literals}], { ${description} })` : union;
  } else {
    typeExpr = description ? `Type.Unknown({ ${description} })` : 'Type.Unknown()';
  }

  const withOptional = field.required ? typeExpr : `Type.Optional(${typeExpr})`;
  return { line: `${field.name}: ${withOptional},` };
};

const emitEnumFile = (enums: EnumDef[]): string => {
  const parts: string[] = [
    GENERATED_HEADER('apps/backend/firebase/dataconnect/schema/schema.gql (enums)'),
    '// Enum schemas use the GraphQL identifiers as emitted by the Data Connect',
    '// SDK (e.g. PRIVATE, PUBLIC, USER, AI). NOT re-exported from @aikami/schemas',
    '// — table row schemas inline these unions so they stay self-contained.',
    "import Type from 'typebox';\n",
  ];
  for (const e of enums) {
    const literals = e.values.map((v) => `Type.Literal('${v}')`).join(', ');
    parts.push(`export const ${e.name}Schema = Type.Union([${literals}]);`);
    parts.push(`export type ${e.name}Data = Type.Static<typeof ${e.name}Schema>;`);
    parts.push(`export type ${e.name} = Type.Static<typeof ${e.name}Schema>;\n`);
  }
  return parts.join('\n');
};

const emitTableFile = (table: TableDef, enumValues: Map<string, string[]>): string => {
  const parts: string[] = [
    GENERATED_HEADER('apps/backend/firebase/dataconnect/schema/schema.gql'),
    `// Row schema for the \`${table.name}\` table (SQL Connect / Data Connect).`,
  ];
  if (table.description) {
    parts.push(`// ${table.description}`);
  }
  parts.push("import Type from 'typebox';\n");

  const fieldLines: string[] = [];
  for (const field of table.fields) {
    const { line, note } = emitField(field, enumValues);
    if (note) {
      fieldLines.push(note);
    }
    if (line) {
      fieldLines.push(line);
    }
  }
  parts.push(`export const ${table.name}RowSchema = Type.Object({`);
  parts.push(fieldLines.map((l) => `  ${l}`).join('\n'));
  parts.push('});\n');
  parts.push(`export type ${table.name}RowData = Type.Static<typeof ${table.name}RowSchema>;`);
  parts.push(`export type ${table.name}Row = Type.Static<typeof ${table.name}RowSchema>;`);

  return parts.join('\n');
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const source = await readFile(SCHEMA_GQL, 'utf8');
  const { enums, tables } = parse(source);
  if (tables.length === 0) {
    throw new Error(`No @table types parsed from ${SCHEMA_GQL} — parser regression?`);
  }

  const enumValues = new Map(enums.map((e) => [e.name, e.values]));

  await mkdir(OUT_DIR, { recursive: true });

  // enums.ts (standalone only — see header)
  await writeFile(join(OUT_DIR, 'enums.ts'), emitEnumFile(enums), 'utf8');

  // Per-table files + index (enums.ts deliberately excluded from the barrel)
  const indexLines = [GENERATED_HEADER('schema.gql tables')];
  for (const table of tables) {
    const file = `${table.snake}.ts`;
    await writeFile(join(OUT_DIR, file), emitTableFile(table, enumValues), 'utf8');
    indexLines.push(`export * from './${file}';`);
  }
  await writeFile(join(OUT_DIR, 'index.ts'), indexLines.filter(Boolean).join('\n'), 'utf8');

  console.log(`Generated ${tables.length} table schemas + ${enums.length} enums → ${OUT_DIR}`);
  console.log(`Tables: ${tables.map((t) => t.name).join(', ')}`);
  console.log(`Enums: ${enums.map((e) => e.name).join(', ')}`);
};

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
