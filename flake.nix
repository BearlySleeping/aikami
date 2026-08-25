{
  description = "AiKami Setup";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-flake.url = "github:pietdevries94/playwright-web-flake";
    herdr.url = "github:ogulcancelik/herdr";
  };

  outputs = {
    # nixd-ignore "attribute `self` of argument is not used" warning
    self,
    nixpkgs,
    flake-utils,
    playwright-flake,
    herdr,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      overlay = final: prev: {
        inherit (playwright-flake.packages.${system}) playwright-test playwright-driver;
      };
      pkgs = import nixpkgs {
        inherit system;
        overlays = [overlay];
      };
      herdr-pkg = herdr.packages.${pkgs.stdenv.hostPlatform.system}.default;

      # ----------------------------------------------------------------------
      # Chromium wrapper with PixiJS DevTools extension injection.
      # Loads the devtools extension via --load-extension at runtime
      # (path from CHROMIUM_USER_FLAGS set in shellHook). The shellHook
      # auto-downloads the latest release from GitHub on first launch.
      #
      # C-046: Nix Chromium Extension Injection
      # ----------------------------------------------------------------------
      chromium-pixi-devtools = pkgs.stdenv.mkDerivation {
        name = "chromium-pixi-devtools";
        phases = ["installPhase"];
        installPhase = ''
          mkdir -p $out/bin
          cp ${pkgs.writeShellScript "chromium" ''
            exec ${pkgs.chromium}/bin/chromium \
              --disable-features=ChromeWhatsNewUI \
              --no-first-run \
              --disable-extensions-except=aamddddknhcagpehecnhphigffljadon \
              --enable-automation \
              ''${CHROMIUM_USER_FLAGS:-} \
              "$@"
          ''} $out/bin/chromium
          ln -s ${pkgs.chromium}/bin/chromium $out/bin/chromium-unwrapped
        '';
      };
    in {
      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          # Runtime
          bun
          nodejs_24

          # TLS CA certificates (needed by apps for HTTPS)
          cacert

          # Playwright with Nix-fixed browsers
          playwright-test

          # Required for `sharp` (libstdc++.so.6 & image processing libs)
          stdenv.cc.cc.lib
          vips
          pkg-config

          # Firebase Emulator (requires JDK)
          jdk

          # ── Hybrid Cloud Emulation ──
          google-cloud-sql-proxy

          # ── Local PostgreSQL (C-387) ──
          # Pinned major (18) so the local engine matches production Neon's
          # wire protocol (C-394 AC-2 — Neon project is PostgreSQL 18, and
          # D-8 requires local ≡ production). Nix provides the binaries;
          # initdb + data live under .postgres/ in the repo (see
          # scripts/src/lib/postgres/lifecycle.ts).
          #
          # 🔴 Major-version bumps do NOT upgrade an existing .postgres/data
          # directory — PostgreSQL refuses to start on a data directory
          # initialised by a different major. After bumping: `postgres:stop`
          # → `postgres:reset --yes` → `postgres:init`. This destroys local
          # data (see README).
          postgresql_18

          # ── Developer Experience ──
          # direnv + nix-direnv for cached flake evaluation
          # (nix-direnv is small; gcloud/jq should be installed separately
          #  via nix profile or system package manager)
          direnv
          nix-direnv

          # Herdr — terminal-native agent multiplexer
          herdr-pkg

          python3
          git-filter-repo
          gh

          # Cloudflare wrangler CLI (C-437) — needed for local D1/R2 dev
          wrangler

          # Chromium wrapped with PixiJS DevTools extension support
          chromium-pixi-devtools
          cargo
          rustc
          webkitgtk_4_1
          gtk3
          libsoup_3
          openssl
          glib-networking
          libayatana-appindicator
          google-cloud-sdk
          xdg-utils
          # tauri-plugin-deep-link's register_all() shells out to
          # `update-desktop-database` *before* xdg-mime — without it the
          # aikami:// scheme is never registered and the device-sign-in
          # redirect fails with "os error 2" (src-tauri/src/lib.rs setup()).
          desktop-file-utils
          # WebKitGTK plays media through GStreamer and resolves its elements
          # (appsrc/appsink/autoaudiosink) from GST_PLUGIN_SYSTEM_PATH_1_0.
          # Without these the webview logs a wall of GStreamer-CRITICAL
          # assertions on every launch and has no audio.
          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base
          gst_all_1.gst-plugins-good
          gst_all_1.gst-plugins-bad
        ];

        # nix-direnv location — used by .envrc on subsequent loads to
        # source direnvrc without re-evaluating nixpkgs
        NIX_DIRENV = "${pkgs.nix-direnv}";

        shellHook = ''
                    # Moon's own toolchain manager (proto) would otherwise download
                    # its own separate "latest" Bun for task execution, diverging
                    # from the Bun this flake pins. Force moon to use the global
                    # (Nix-provided) Bun instead — same switch CI uses
                    # (.github/workflows/pr-checks.yml).
                    export MOON_TOOLCHAIN_FORCE_GLOBALS=true

                    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
                    export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
                    echo "🎭 Playwright browsers from Nix: $PLAYWRIGHT_BROWSERS_PATH"

                    # Force Bun/Node to find the Nix-managed C++ standard libraries for native addons
                    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [pkgs.stdenv.cc.cc.lib pkgs.vips pkgs.onnxruntime]}:''${LD_LIBRARY_PATH:-}"

                    # ONNX Runtime pkg-config (needed by ort crate)
                    export PKG_CONFIG_PATH="${pkgs.onnxruntime.dev}/lib/pkgconfig:''${PKG_CONFIG_PATH:-}"
                    export ORT_LIB_LOCATION="${pkgs.onnxruntime}/lib"
                    export ORT_PREFER_DYNAMIC_LINK=1

                    # ── AiKami Shell Integration ──
                    # Source direnv helpers if available (loaded after use flake by .envrc)
                    # The marker file signals to .envrc that the Nix shell is ready
                    export AIKAMI_NIX_READY=1

                    # ── PixiJS DevTools Extension (C-046) ──
                    # Auto-downloads the latest devtools from GitHub releases if
                    # PIXI_DEVTOOLS_PATH is not explicitly set. Override by
                    # setting PIXI_DEVTOOLS_PATH to a custom unpacked extension dir.
                    PIXI_DEVTOOLS_DIR="''$HOME/.local/share/aikami/pixi-devtools"
                    if [ -z "''${PIXI_DEVTOOLS_PATH:-}" ] || [ ! -f "''${PIXI_DEVTOOLS_PATH:-}/manifest.json" ]; then
                      if [ ! -f "$PIXI_DEVTOOLS_DIR/.version" ]; then
                        rm -rf "$PIXI_DEVTOOLS_DIR"
                        mkdir -p "$PIXI_DEVTOOLS_DIR"
                        echo "📥 Downloading PixiJS DevTools extension from GitHub..."
                        MANIFEST_DIR=""
                        if MANIFEST_DIR=$(python3 -c "
          import urllib.request, zipfile, io, os, sys

          url = 'https://github.com/pixijs/devtools/releases/latest/download/chrome.zip'
          dest_root = os.path.expanduser(sys.argv[1])

          data = urllib.request.urlopen(url).read()
          with zipfile.ZipFile(io.BytesIO(data)) as zf:
              zf.extractall(dest_root)

          # Find manifest.json anywhere in the tree
          for root, dirs, files in os.walk(dest_root):
              if 'manifest.json' in files:
                  print(root)
                  # Write version marker so we don't re-download every time
                  with open(os.path.join(dest_root, '.version'), 'w') as f:
                      f.write('installed')
                  sys.exit(0)

          sys.exit(1)
          " "$PIXI_DEVTOOLS_DIR" 2>/dev/null); then
                          export PIXI_DEVTOOLS_PATH="$MANIFEST_DIR"
                          echo "✅ PixiJS DevTools v2 installed to $MANIFEST_DIR"
                        else
                          echo "⚠️  Download failed — check network or set PIXI_DEVTOOLS_PATH manually"
                          echo "   https://github.com/pixijs/devtools/releases"
                        fi
                      else
                        # Re-find manifest after cached extraction
                        MANIFEST_DIR=$(find "$PIXI_DEVTOOLS_DIR" -name manifest.json -printf '%h' -quit 2>/dev/null)
                        if [ -n "$MANIFEST_DIR" ]; then
                          export PIXI_DEVTOOLS_PATH="$MANIFEST_DIR"
                        fi
                      fi
                    fi

                    if [ -n "''${PIXI_DEVTOOLS_PATH:-}" ] && [ -f "''${PIXI_DEVTOOLS_PATH:-}/manifest.json" ]; then
                      export CHROMIUM_USER_FLAGS="--load-extension=''${PIXI_DEVTOOLS_PATH:-}"
                      echo "🔧 PixiJS DevTools loaded from: ''${PIXI_DEVTOOLS_PATH:-}"
                    else
                      export CHROMIUM_USER_FLAGS=""
                      echo "⚠️  PixiJS DevTools not found — set PIXI_DEVTOOLS_PATH to unpacked extension"
                      echo "   https://github.com/pixijs/devtools/releases"
                    fi

                    # TLS backend for the WebKitGTK webview. libsoup3 does HTTPS
                    # through a GIO module (glib-networking's libgiognutls.so), which
                    # it finds only via GIO_EXTRA_MODULES — NixOS sets that variable
                    # system-wide but populates it with gvfs + dconf only. Listing
                    # glib-networking in `packages` above is NOT enough: mkShell puts
                    # it on PATH, not in the module search path. Without this, every
                    # https request from the webview fails with WebKit's opaque
                    # "TypeError: Load failed" — which looks exactly like a CSP or CORS
                    # problem and is neither (auth_service.svelte.ts initialize()).
                    # Only affects running the binary here; the released AppImage
                    # carries its own gio modules via linuxdeploy-plugin-gtk.
                    export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"

                    # GStreamer element registry for the WebKitGTK webview (see the
                    # gst_all_1 packages above).
                    export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" (with pkgs.gst_all_1; [gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad])}"

                    # SSL CA certificates — needed by apps (like Zed git panel) for HTTPS
                    export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
                    export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"
                    export CURL_CA_BUNDLE="$SSL_CERT_FILE"
        '';
      };
    });
}
