## Context

The Godot web export needs automated E2E testing to verify menu functionality matches the desktop Godot experience. Currently, manual testing is required for each web build, which is time-consuming and not scalable for CI/CD pipelines.

## Goals / Non-Goals

**Goals:**
- Enable automated browser testing via Playwright
- Test main menu button interactions (Start, Options, Credits, Quit)
- Verify scene transitions work correctly in web build
- Capture screenshots for visual regression testing
- Integrate with CI pipeline

**Non-Goals:**
- Testing game gameplay mechanics (menu system only)
- Performance benchmarking
- Load testing with multiple concurrent users
- Cross-browser compatibility (Chrome/Firefox only)

## Decisions

1. **Playwright over Selenium**: Mature API, better reliability, built-in screenshot capabilities
2. **Local web server in tests**: Use `bun run export:serve` to serve the web build during tests
3. **Single browser focus**: Chrome as primary browser for E2E tests
4. **Screenshots stored in artifacts**: Store in `tests/e2e/screenshots/` directory
5. **Tests in `tests/e2e/`**: Place E2E tests alongside unit tests in dedicated folder

## Risks / Trade-offs

- **Risk**: Web server startup timing - May need to add wait-for-server logic in tests
- **Risk**: Godot web export stability - WebGL crashes could affect test reliability
- **Trade-off**: Additional CI time for E2E tests vs. confidence in web build quality