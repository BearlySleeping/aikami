---
name: config-development
description: Best practices for developing and managing configuration files in a monorepo. Includes TypeScript configs, build tools, linters, task runners, and environment management.
version: 1.0.0
author: Aikami Team
tags: ["config", "typescript", "monorepo", "biome", "moon", "vite"]
---

# Config Development Skill

This skill provides comprehensive guidelines for managing configuration files in a modern TypeScript monorepo.

## 1. Project Configuration Files

### TypeScript Configuration

#### tsconfig.json (Root)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  }
}
```

#### tsconfig.json (App/Package)

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "preserve",
    "jsxImportSource": "svelte",
    "baseUrl": ".",
    "paths": {
      "$lib": ["./src/lib"],
      "$lib/*": ["./src/lib/*"],
      "@aikami/*": ["../../packages/*/src"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 2. Biome Configuration

### biome.json (Root)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "ignore": ["node_modules/", "dist/", ".svelte-kit/", "build/"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "quoteStyle": "single",
    "quotes": {
      "jsx": "double"
    },
    "trailingCommas": "all",
    "semicolons": "always"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "style": {
        "useImportType": "explicit",
        "noNonNullAssertion": "off"
      },
      "complexity": {
        "noForEach": "off"
      }
    }
  },
  "javascript": {
    "formatter": {
      "arrowParentheses": "always",
      "bracketSpacing": true,
      "quoteProps": "asNeeded"
    }
  }
}
```

---

## 3. Vite Configuration

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ['@sanity/client'],
  },
  resolve: {
    alias: {
      $lib: '/src/lib',
    },
  },
});
```

---

## 4. Moon Configuration

### moon.yml (Root)

```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
nodeVersion: '20'

tasks:
  typecheck:
    command: 'tsc --noEmit'
    inputs:
      - '@all'
  lint:
    command: 'biome check .'
    inputs:
      - '@all'
  format:
    command: 'biome format . --write'
    inputs:
      - '@all'
  test:
    command: 'bun test'
    inputs:
      - '@all'
```

### moon.yml (Project)

```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
layer: 'application'
stack: 'frontend'

project:
  title: 'PWA'
  description: 'Main Progressive Web Application'

dependsOn:
  - 'frontend-services'
  - 'schemas'
  - 'types'

fileGroups:
  sources:
    - 'src/**/*'
    - 'static/**/*'
  configs:
    - 'package.json'
    - 'tsconfig.json'
    - 'vite.config.*'

tasks:
  dev:
    command: 'bun run dev'
    preset: 'server'
  build:
    command: 'bun run build'
    inputs:
      - '@group(sources)'
      - '@group(configs)'
    outputs:
      - '.svelte-kit'
      - 'build'
  test:
    command: 'bun run test'
    deps:
      - 'build'
```

---

## 5. Package.json Scripts

### Standard Script Structure

```json
{
  "name": "@app/example",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "biome lint .",
    "format": "biome format .",
    "fix": "biome check --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "validate": "bun run typecheck && bun run lint && bun run test"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

---

## 6. Environment Configuration

### .env.example

```bash
# Firebase
PUBLIC_FIREBASE_API_KEY=your_api_key
PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
PUBLIC_FIREBASE_PROJECT_ID=your_project_id
PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123

# API
PUBLIC_API_URL=https://api.example.com
API_SECRET=your_secret

# Feature Flags
PUBLIC_ENABLE_ANALYTICS=true
PUBLIC_DEBUG_MODE=false
```

### Environment Type Safety

```typescript
// src/env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PUBLIC_FIREBASE_API_KEY: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID: string;
  readonly PUBLIC_API_URL: string;
  readonly API_SECRET: string;
  readonly PUBLIC_DEBUG_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

---

## 7. Biome Configuration for Different Targets

### biome.json (Library)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "pedantic": {
        "exported": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

### biome.json (Testing)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  },
  "formatter": {
    "enabled": true
  }
}
```

---

## 8. Task Runner Patterns

### Moon Task Conventions

```bash
# Root level (all projects)
bun moon run :typecheck    # Typecheck all
bun moon run :lint         # Lint all
bun moon run :fix          # Fix all
bun moon run :build        # Build all
bun moon run :test         # Test all

# Affected (changed projects only)
bun moon run :build --affected
bun moon run :test --affected

# Specific project
bun moon run pwa:dev
bun moon run pwa:build
bun moon run pwa:test
bun moon run pwa:lint
bun moon run pwa:fix
```

---

## 9. Monorepo Workspace Configuration

### Root package.json

```json
{
  "name": "@aikami/workspace",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "deps:update": "bun run syncpack update",
    "deps:sync": "bun run syncpack fix-mismatches",
    "deps:check": "bun run syncpack list",
    "deps:list": "bun run syncpack list --sort"
  },
  "devDependencies": {
    "syncpack": "^12.0.0"
  }
}
```

### Workspace package.json

```json
{
  "name": "@aikami/types",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "lint": "biome lint .",
    "format": "biome format .",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## 10. Best Practices

### 1. Use Consistent Formatting

Always run formatting before commits:

```bash
bun moon run :fix
# or
biome check --write .
```

### 2. Type Everything

Enable strict mode in all TypeScript configs:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 3. Validate Before Build

Always run validation before building:

```bash
bun moon run :validate
```

### 4. Use Path Aliases

Define consistent path aliases:

```json
{
  "paths": {
    "$lib": ["./src/lib"],
    "$lib/*": ["./src/lib/*"],
    "@aikami/*": ["../../packages/*/src"]
  }
}
```

### 5. Separate Concerns

Use different configs for different targets:

- `tsconfig.json` - Main config
- `tsconfig.test.json` - Testing config
- `tsconfig.node.json` - Node.js specific

---

## 11. Anti-Patterns to Avoid

1. ❌ Disabling strict mode in TypeScript
2. ❌ Not using Biome/Vite for consistency
3. ❌ Hardcoding paths (use aliases)
4. ❌ Not validating before building
5. ❌ Inconsistent indentation or quotes
6. ❌ Missing `"type": "module"` in package.json
7. ❌ Not using moon for task orchestration
8. ❌ Storing secrets in config files (use .env)
