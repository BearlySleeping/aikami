# Proposal: GameJS Playwright Testing

## Summary

Integrate Playwright with Godot web export to enable automated E2E testing of the game menu system.

## Problem

Manual testing of Godot web builds is time-consuming. Need automated tests that:
- Navigate to localhost web server
- Click buttons and verify navigation
- Take screenshots for visual regression
- Verify menu state changes

## Solution

Use Playwright to:
1. Serve the web export locally
2. Launch browser and navigate to game
3. Click buttons (Start, Options, Credits, Quit)
4. Verify scene transitions
5. Capture screenshots

## Context

- Godot web export works: `bun run export:web` creates dist/web/
- Web server works: `bun run export:serve` starts server on port 3000
- Menu buttons are functional in desktop Godot
- Need to verify web build works identically

## Alternatives Considered

- **godotto**: Godot-specific testing tool - less mature than Playwright
- **Selenium**: Older, less reliable than Playwright
- **Manual testing**: Time-consuming, not scalable

## Success Criteria

- [ ] Playwright can connect to localhost:3000
- [ ] Main menu buttons are clickable
- [ ] Navigation to settings/credits works
- [ ] Screenshots are captured
- [ ] Tests run in CI