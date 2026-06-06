# Contract — C-046 Nix Chromium Extension Injection

## Metadata

| Field        | Value                                        |
| ------------ | -------------------------------------------- |
| Source       | Environment Optimization / Tooling Sync      |
| Target       | Dev Environment Infrastructure (`flake.nix`) |
| Priority     | P1                                           |
| Dependencies | C-043, C-044                                 |
| Status       | not_started                                  |
| Version      | 1.0.0                                        |

## Overview

This contract updates the repository's Nix Flake environment configuration to dynamically wrap Chromium with pre-defined enterprise policies. It injects the PixiJS DevTools extension (`aamddddknhcagpehecnhphigffljadon`) natively into the development shell profile. This bypasses terminal policy restrictions and Google registration endpoints, ensuring that any browser instances launched via developer commands have access to structural canvas inspection panels out of the box.

## Design Reference

- `flake.nix`: Main declarative system package environment layout.
- `apps/frontend/pwa/src/routes/(public)/dev/lpc-component`: Active canvas debugging target route.
- Nixpkgs Chromium Wrapper Pattern: Utilizing `chromium.override` with explicit `commandLineArgs` or policies mapping.

## Changes Detail

### 1. Modify `flake.nix`

Update your `flake.nix` to declare a wrapped Chromium instance directly inside the `let / in` block of your system evaluator, then clear the raw `chromium` array item:

```nix
# Change inside the development shell evaluation loop:
in {
  devShells.default = let
    # Wrap chromium with declarative extension force-lists
    configuredChromium = pkgs.chromium.override {
      commandLineArgs = [
        "--load-extension-policy=aamddddknhcagpehecnhphigffljadon"
        "--policy='{\"ExtensionInstallForcelist\": [\"aamddddknhcagpehecnhphigffljadon;[https://clients2.google.com/service/update2/crx](https://clients2.google.com/service/update2/crx)\"]}'"
      ];
    };
  in pkgs.mkShell {
    packages = with pkgs; [
      bun
      nodejs_24
      playwright-test
      # ... Keep existing allocations ...

      # Replace raw 'chromium' entry with our pre-configured wrapper
      configuredChromium

      google-cloud-sdk
      postgresql
    ];
    Acceptance Criteria
    AC-1: Declarative Environment Rebuild Compliance

        Given an altered flake.nix specification tracking the environment,

        When the developer executes nix-shell or updates the environment shell profile via direnv reload,

        Then the package manager must complete configuration steps successfully, outputting a wrapped executable instance.

    AC-2: Programmatic Policy Attachment Stability

        Given an active shell profile initialized through the wrapper,

        When the command chromium is executed from the terminal interface,

        Then it must launch without throwing enterprise endpoint enrollment block traces or profile initialization crashes.

    Edge Cases & Gotchas

        Nixpkgs Parameter Shift: Depending on the exact target channel commit matching nixos-unstable, the syntax for overriding system browser wrappers may slightly alter. If a top-level override target drops, use pkgs.wrapChromium pkgs.chromium { ... } as an alternative setup vector to ensure maximum build longevity.
```
