/**
 * Validates Data Connect GraphQL schema files: no underscore in field names.
 *
 * Firebase SQL Connect reserves underscores in GraphQL field names for internal
 * relationship compilers and helper queries. Field names must use camelCase.
 * Column-level `@col(name: "snake_case")` mappings are unaffected.
 *
 * Usage: bun run scripts/src/lib/ops/validate_gql_fields.ts [directory]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

function findGqlFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        walk(full);
      } else if (entry.endsWith('.gql') || entry.endsWith('.graphql')) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

type FieldWithUnderscore = {
  line: number;
  name: string;
  context: string;
};

function validateGqlFile(path: string): FieldWithUnderscore[] {
  const violations: FieldWithUnderscore[] = [];
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');

  // State tracking to know when we're inside a type definition
  let insideType = false;
  let currentTypeName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    // Track type definition boundaries
    const typeMatch = trimmed.match(/^type\s+(\w+)\s*(?:@\w+.*)?\s*\{/);
    if (typeMatch) {
      insideType = true;
      currentTypeName = typeMatch[1];
      continue;
    }

    if (insideType && trimmed === '}') {
      insideType = false;
      currentTypeName = '';
      continue;
    }

    if (!insideType) {
      continue;
    }

    // Match field definitions: `fieldName: Type` or `fieldName: Type!` or `fieldName: Type @directive(...)`
    // Skip `@col` directive values — those can be snake_case.
    const fieldMatch = trimmed.match(/^(\w+)\s*:/);
    if (!fieldMatch) {
      continue;
    }

    const fieldName = fieldMatch[1];

    // Check for underscore in the field name itself
    if (fieldName.includes('_')) {
      violations.push({
        line: lineNum,
        name: fieldName,
        context: `type ${currentTypeName} { ... ${trimmed} }`,
      });
    }
  }

  return violations;
}

function main() {
  const targetArg = process.argv[2];
  const searchDir = targetArg ? resolve(REPO_ROOT, targetArg) : REPO_ROOT;

  const gqlFiles = findGqlFiles(searchDir);

  if (gqlFiles.length === 0) {
    console.log('✓ No .gql/.graphql schema files found — nothing to validate.');
    process.exit(0);
  }

  console.log(`Validating ${gqlFiles.length} GraphQL schema file(s) for underscore field names...`);

  let totalViolations = 0;
  for (const file of gqlFiles) {
    const violations = validateGqlFile(file);
    if (violations.length > 0) {
      for (const v of violations) {
        console.error(
          `${file}:${v.line}: Field name "${v.name}" contains underscore.\n` +
            `  SQL Connect reserves underscores in GraphQL field names.\n` +
            `  Rename to camelCase. @col(name: "snake_case") column mappings are fine.\n` +
            `  Context: ${v.context}`,
        );
      }
      totalViolations += violations.length;
    }
  }

  if (totalViolations > 0) {
    console.error(`\n✗ ${totalViolations} underscore violation(s) found in GraphQL field names.`);
    console.error('  See docs/architecture/limitations.md § Data Connect GraphQL Field Naming');
    process.exit(1);
  }

  console.log('✓ All GraphQL field names pass underscore validation.');
}

main();
