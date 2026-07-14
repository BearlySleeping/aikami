# Architecture Documentation

## Overview

This project follows a **View-ViewModel-Service** architecture pattern with Svelte 5 and TypeScript. All reactive state is managed using Svelte 5 runes (`$state`, `$derived`), and all business logic is encapsulated in ViewModels that extend the `BaseViewModel` class.

## Core Principles

### 1. **Views (.svelte files) have NO logic**

- Zero service imports
- Zero methods/functions
- Zero business logic
- Only presentation and event binding to ViewModel methods

### 2. **ViewModels handle ALL logic**

- All business logic and state management
- Service orchestration
- Data transformation
- Event handling
- **Use regular class methods, NOT arrow functions** (arrow functions break `super` and `this` references)

### 3. **Services provide core functionality**

- Authentication
- Routing
- API communication
- Database operations

## Directory Structure

```
src/lib/
├── client/
│   └── services/           # Service implementations
│       ├── api/           # API services
│       ├── app/           # App-level services
│       ├── database/      # Database services
│       └── router/        # Router service
├── views/                 # View components and ViewModels
│   ├── app/
│   │   ├── AppView.svelte
│   │   ├── app-view-model.svelte.ts
│   │   ├── drawer/
│   │   │   └── navigation/
│   │   │       ├── NavigationDrawer.svelte
│   │   │       └── navigation-drawer-view-model.svelte.ts
│   │   └── bar/
│   │       ├── AppBar.svelte
│   │       └── app-bar-view-model.svelte.ts
│   ├── auth/
│   │   ├── LoginView.svelte
│   │   └── login-view-model.svelte.ts
│   └── settings/
│       └── SettingsView.svelte
├── services.ts            # Service exports
└── i18n.ts               # Internationalization

packages/frontend/services/
└── src/lib/
    ├── base/
    │   └── base-view-model.svelte.ts  # Base class for all ViewModels
    └── services/          # Core service implementations
```

## ViewModel Pattern

### Structure

Every ViewModel must:

1. **Extend BaseViewModel**

```typescript
import { authService, BaseViewModel, type BaseViewModelOptions } from '$services'

class MyViewModel extends BaseViewModel implements MyViewModelInterface {
  // Implementation
}
```

2. **Define Options Type**

```typescript
export type MyViewModelOptions = BaseViewModelOptions & {
  // Add specific options
  myOption?: string
}
```

3. **Define Interface Type (Must Extend BaseViewModelInterface)**

```typescript
import type { BaseViewModelInterface } from '$services'

export type MyViewModelInterface = BaseViewModelInterface & {
  readonly someState: string
  readonly derivedValue: number

  someMethod(): Promise<void>
}
```

4. **Export Factory Function**

```typescript
export const getMyViewModel = (
  options: MyViewModelOptions,
): MyViewModelInterface => MyViewModel.create(options)
```

### Example ViewModel

```typescript
import {
  authService,
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '$services'
import t from '$i18n'

export type LoginViewModelOptions = BaseViewModelOptions & {
  // Specific options if needed
}

export type LoginViewModelInterface = BaseViewModelInterface & {
  /**
   * The email of the user.
   */
  readonly email: string

  /**
   * Register the user.
   */
  register(): Promise<void>
}

class LoginViewModel extends BaseViewModel implements LoginViewModelInterface {
  readonly email = $state('')

  async register(): Promise<void> {
    await authService.register({
      email: this.email,
    })
  }
}

export const getLoginViewModel = (
  options: LoginViewModelOptions,
): LoginViewModelInterface =>  LoginViewModel.create(options)
```

### Example View

```svelte
<script lang="ts">
    import { getLoginViewModel } from "./login-view-model.svelte.ts";
    import t from "$i18n";

    const viewModel = getLoginViewModel({});
</script>

<div class="min-h-screen flex items-center justify-center bg-base-200">
    <div class="card w-full max-w-md bg-base-100 shadow-xl">
        <div class="card-body">
            <h2 class="card-title">{t.login()}</h2>

            {#if viewModel.error}
                <div class="alert alert-error">
                    <span>{viewModel.error}</span>
                </div>
            {/if}

            <form onsubmit|preventDefault={() => viewModel.login()}>
                <div class="form-control">
                    <label class="label" for="email">
                        <span class="label-text">{t.email()}</span>
                    </label>
                    <input
                        id="email"
                        type="email"
                        class="input input-bordered"
                        bind:value={viewModel.email}
                        disabled={viewModel.isLoading}
                    />
                </div>

                <div class="form-control">
                    <label class="label" for="password">
                        <span class="label-text">{t.password()}</span>
                    </label>
                    <input
                        id="password"
                        type="password"
                        class="input input-bordered"
                        bind:value={viewModel.password}
                        disabled={viewModel.isLoading}
                    />
                </div>


                <button
                    type="submit"
                    class="btn btn-primary"
                    disabled={viewModel.isLoading}
                >
                    {#if viewModel.isLoading}
                        <span class="loading loading-spinner"></span>
                    {/if}
                    {t.login()}
                </button>
            </form>
        </div>
    </div>
</div>
```

## Svelte 5 Runes

### State Management

- **`$state()`** - For reactive local state

```typescript
email = $state('')
isLoading = $state(false)
```

- **`$derived()`** - For computed/derived values

```typescript
isLoggedIn = $derived(authService.isLoggedIn)
fullName = $derived(`${this.firstName} ${this.lastName}`)
```

- **`$derived.by()`** - For complex derived logic

```typescript
navigationItems = $derived.by(() => {
  const route = routerService.currentRoute
  return items.map((item) => ({
    ...item,
    active: item.route === route,
  }))
})
```

### DO NOT use:

- `$:` reactive statements (legacy Svelte 3/4)
- `export let` for props (use `$props()`)
- `on:click` handlers (use `onclick`)

## Import Rules

### Services and Base Classes

```typescript
import { authService, BaseViewModel, type BaseViewModelOptions, routerService } from '$services'
```

### Internationalization

```typescript
import t from '$i18n';

// Usage in ViewModel
const label = t.home();

// Usage in Views
<h1>{t.page_title()}</h1>
<p>{t.greeting({ name: userName })}</p>
```

**Important:** All user-facing text MUST be added to `messages/en.json` (and other language files) and accessed via `t`:

- ❌ `<h1>My Page Title</h1>`
- ✅ `<h1>{t.page_title()}</h1>`

### Types

- **Prefer `type` over `interface`**

```typescript
// Good
export type MyViewModelOptions = BaseViewModelOptions & {
  myOption: string
}

// Avoid
export interface MyViewModelOptions extends BaseViewModelOptions {
  myOption: string
}
```

## BaseViewModel

All ViewModels extend `BaseViewModel` which provides:

### Properties

- `initialized: boolean` - Whether the ViewModel has been initialized
- `isLoading: boolean` - Loading state
- `error: string | null` - Error message

### Methods

- `initialize(): Promise<void>` - Override for initialization logic
- `setLoading(loading: boolean): void` - Set loading state
- `setError(error: string | null): void` - Set error message
- `clearError(): void` - Clear error state
- `dispose(): void` - Override for cleanup logic

## Service Layer

### Available Services

- `authService` - Authentication (login, logout, user state)
- `routerService` - Navigation and routing
- `appService` - App-level state and functionality
- `dialogService` - Dialog management
- `analyticService` - Analytics tracking

### Service Usage Pattern

Services are imported from `$services` and used directly in ViewModels:

```typescript
import { authService, routerService } from '$services'

class MyViewModel extends BaseViewModel {
  async login(): Promise<void> {
    await authService.login(email, password)
    await routerService.goToRoute({
      route: 'home',
      pathParameters: undefined,
      queryParameters: undefined,
    })
  }
}
```

## Styling with DaisyUI

All components use DaisyUI classes for styling:

```svelte
<button class="btn btn-primary">Click Me</button>
<div class="card bg-base-100 shadow-xl">
    <div class="card-body">
        <h2 class="card-title">Card Title</h2>
    </div>
</div>
```

### Responsive Design

- Use DaisyUI's responsive classes
- Mobile-first approach
- Desktop and mobile variants when needed

## Migration Notes

When migrating old code:

1. **Remove all logic from Views** - Move to ViewModel
2. **Replace `on:` handlers** - Use `onclick`, `oninput`, etc.
3. **Replace `bind:value`** - Use controlled inputs with ViewModel setters
4. **Remove `$:` statements** - Use `$derived()`
5. **Update imports** - Use `$services` and `$i18n`
6. **Use `type` instead of `interface`**
7. **Options pattern** - `BaseViewModelOptions & { }`

## Testing

ViewModels are designed to be testable in isolation:

```typescript
import { describe, expect, it } from 'vitest'
import { getLoginViewModel } from './login-view-model.svelte'

describe('LoginViewModel', () => {
  it('should validate email and password', async () => {
    const vm = getLoginViewModel({})

    vm.setEmail('test@example.com')
    vm.setPassword('password123')

    await vm.login()

    expect(vm.error).toBeNull()
  })
})
```

## Common Patterns

### Class Methods (NOT Arrow Functions)

**IMPORTANT:** Always use regular class methods in ViewModels, NOT arrow functions. Arrow functions break `super` and `this` references.

```typescript
// ✅ CORRECT: Regular class method
class MyViewModel extends BaseViewModel {
  async someAction(): Promise<void> {
    this.setLoading(true)
    // ...
  }
}

// ❌ INCORRECT: Arrow function (breaks super and this)
class MyViewModel extends BaseViewModel {
  someAction = async (): Promise<void> => {
    this.setLoading(true)
    // ...
  }
}
```

### Loading States

```typescript
/**
 * Performs some action with loading and error handling.
 */
async someAction(): Promise<void> {
    this.setLoading(true);
    try {
        await someService.doSomething();
    } catch (err) {
        this.setError(err.message);
    } finally {
        this.setLoading(false);
    }
}
```

### Navigation

```typescript
await routerService.goToRoute({
  route: 'routeName',
  pathParameters: { id: '123' },
  queryParameters: { tab: 'settings' },
})
```

### Form Handling

```typescript
// ViewModel
email = $state('')

// View
<input
  bind:value={viewModel.email}
/>
```

## Best Practices

1. ✅ **Keep Views simple** - Only presentation logic
2. ✅ **ViewModels are testable** - Pure business logic
3. ✅ **Use factory functions** - `getMyViewModel(options)`
4. ✅ **Type everything** - Leverage TypeScript
5. ✅ **Interfaces extend BaseViewModelInterface** - Use `& {}` pattern
6. ✅ **Use `$derived()` for computed values** - Not manual watchers
7. ✅ **Services handle side effects** - ViewModels orchestrate
8. ✅ **Error handling in ViewModel** - Use `setError()`
9. ✅ **Loading states** - Use `setLoading()`
10. ✅ **Cleanup in `dispose()`** - Remove listeners, cancel requests
11. ✅ **Options pattern for flexibility** - Easy to extend
12. ✅ **Regular class methods** - NOT arrow functions in classes
13. ✅ **JSDoc on interface methods** - Descriptions only, no types in JSDoc in the class.
    </parameter>

## Anti-Patterns (DON'T DO THIS)

❌ Logic in Views
❌ Service imports in Views
❌ Methods/functions in Views
❌ Using `$:` reactive statements
❌ Using `interface` instead of `type`
❌ ViewModel interfaces not extending `BaseViewModelInterface`
❌ Using `on:` event handlers
❌ Using `bind:value` without ViewModel setter
❌ Importing from `$lib/services.ts` directly in views
❌ Hardcoded strings (use i18n)
❌ Arrow functions in `$derived()` when not needed
❌ **Arrow function methods in classes** (breaks `super` and `this`)
❌ Missing JSDoc on public methods
