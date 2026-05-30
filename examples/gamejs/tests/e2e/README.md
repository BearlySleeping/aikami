# E2E Tests

These tests use Playwright to test the Godot web export in a browser.

## Running Tests

```bash
bun run test:e2e
```

## Requirements

### Local Development

The Playwright browsers require system dependencies. On Ubuntu/Debian:

```bash
sudo apt-get install -y libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-1 libcairo2 libasound2 libatspi2.0-0
```

Or use Playwright's dependency installer:

```bash
npx playwright install --with-deps
```

### CI

In CI environments, browsers will be installed automatically with the correct dependencies.

## Test Structure

- `server.test.ts` - Tests web server connectivity
- `menu.test.ts` - Tests main menu loading
- `screenshot.test.ts` - Tests screenshot capture
