# Ubuntu 22.04 build image for producing an Aikami AppImage on hosts that
# can't run Tauri's AppImage bundler natively (NixOS — see
# apps/frontend/client/scripts/tauri_build.ts for why).
#
# 22.04 on purpose, matching PLATFORM_DEFAULTS in scripts/src/lib/deploy/
# ci_planning.ts: an AppImage only runs on glibc >= the build machine's, and
# 22.04's glibc 2.35 is the floor we ship against. Building this locally on a
# newer base would produce an AppImage that works here and nowhere else.
#
# Driven by: bun run scripts -- tauri_appimage
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Same set the release workflow installs (release.yml → "Install Linux system
# dependencies"), plus xdg-utils (the bundler copies /usr/bin/xdg-mime and
# /usr/bin/xdg-open into the AppDir for tauri-plugin-deep-link) and libfuse2
# (linuxdeploy is itself an AppImage).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      patchelf \
      libssl-dev \
      libxdo-dev \
      build-essential \
      pkg-config \
      curl wget file unzip git ca-certificates \
      xdg-utils \
      libfuse2 \
      python3 \
    && rm -rf /var/lib/apt/lists/*

# Rust (rustup, not apt — 22.04's packaged toolchain is far too old for Tauri 2).
ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/opt/bun/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --profile minimal

# Bun (the monorepo's package manager and script runner).
ENV BUN_INSTALL=/opt/bun
RUN curl -fsSL https://bun.sh/install | bash

# Moon's proto would otherwise download its own Bun, diverging from the one
# above — same switch the flake and CI use.
ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true

# The driver runs this image as the *host* user (docker --user / podman
# --userns=keep-id) so build output in the mounted worktree isn't root-owned.
# That user still needs to write cargo's package-cache and registry, and the
# out-of-tree target dir the driver mounts a volume onto.
RUN mkdir -p /opt/cargo/registry /target-cache \
    && chmod -R a+rwX /opt/cargo /opt/rustup /target-cache

WORKDIR /workspace
