# C-TEST-001: isSwarmReady Utility Function

## Summary
Add `isSwarmReady` utility function that returns `true` to `packages/shared/utils/src/lib/common/utils.ts`.

## Files
- **Create**: `packages/shared/utils/src/lib/common/utils.ts` — add `isSwarmReady` function
- **Modify**: `packages/shared/utils/src/lib/common/utils.test.ts` — add test

## Implementation

```typescript
export const isSwarmReady = (): boolean => true;
```

## Tests
```typescript
describe('isSwarmReady', () => {
  test('should return true', () => {
    expect(isSwarmReady()).toBe(true);
  });
});
```

## Verification
- `moon run utils:fix`
- `moon run utils:typecheck`
- `moon run utils:test`
