import { join, dirname } from 'https://deno.land/std@0.224.0/path/mod.ts';
import { readJson } from 'https://deno.land/std@0.224.0/json/read.ts';

interface DenoJson {
  name?: string;
  version?: string;
  tasks?: Record<string, string>;
  workspace?: string[];
  [key: string]: unknown;
}

async function findPackageDir(
  workspaceRoot: string,
  packageName: string,
): Promise<string | null> {
  const rootConfigPath = join(workspaceRoot, 'deno.json');
  try {
    const rootConfig = (await readJson(rootConfigPath)) as DenoJson;
    if (!rootConfig.workspace) {
      console.error(
        `Error: No "workspace" array found in root ${rootConfigPath}`,
      );
      return null;
    }

    for (const memberPath of rootConfig.workspace) {
      const packageConfigPath = join(workspaceRoot, memberPath, 'deno.json');
      try {
        const packageConfig = (await readJson(packageConfigPath)) as DenoJson;
        if (packageConfig.name === packageName) {
          return join(workspaceRoot, memberPath);
        }
      } catch (e) {
        if (e.name !== 'NotFound') {
          console.warn(
            `Warning: Could not read or parse ${packageConfigPath}: ${e.message}`,
          );
        }
        // If deno.json doesn't exist or is invalid, try to check parent dir for name
        const potentialPackageJsonPath = join(workspaceRoot, memberPath, 'package.json');
        try {
            const packageJson = (await readJson(potentialPackageJsonPath)) as { name?: string };
            if (packageJson.name === packageName) {
                return join(workspaceRoot, memberPath);
            }
        } catch { /* ignore if package.json not found */ }
      }
    }
  } catch (e) {
    console.error(`Error reading root ${rootConfigPath}: ${e.message}`);
    return null;
  }
  return null;
}

async function main() {
  if (Deno.args.length < 2) {
    console.error(
      'Usage: deno run -A <this_script.ts> <package_name> <task_name> [task_args...]',
    );
    console.error('Example: deno task pkg @aikami/constants lint');
    Deno.exit(1);
  }

  const [packageName, taskName, ...taskArgs] = Deno.args;
  const workspaceRoot = Deno.cwd(); // Assuming script is run from workspace root

  const packageDir = await findPackageDir(workspaceRoot, packageName);

  if (!packageDir) {
    console.error(
      `Error: Package "${packageName}" not found in workspace or its deno.json is missing/invalid.`,
    );
    Deno.exit(1);
  }

  const packageConfigPath = join(packageDir, 'deno.json');
  let packageConfig: DenoJson;
  try {
    packageConfig = (await readJson(packageConfigPath)) as DenoJson;
  } catch (e) {
    console.error(`Error reading package config ${packageConfigPath}: ${e.message}`);
    Deno.exit(1);
  }


  if (!packageConfig.tasks || !packageConfig.tasks[taskName]) {
    console.error(
      `Error: Task "${taskName}" not found in ${packageConfigPath}`,
    );
    Deno.exit(1);
  }

  console.log(
    `Running task "${taskName}" for package "${packageName}" in ${packageDir}`,
  );

  const command = new Deno.Command('deno', {
    args: ['task', '-q', '--config', packageConfigPath, '--cwd', packageDir, taskName, ...taskArgs],
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: packageDir, // Set current working directory for the task
  });

  const status = await command.output();

  if (!status.success) {
    console.error(
      `Task "${taskName}" for package "${packageName}" failed.`,
    );
    Deno.exit(status.code);
  }
}

if (import.meta.main) {
  await main();
}