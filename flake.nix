{
  description = "AiKami Setup";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-flake.url = "github:pietdevries94/playwright-web-flake";
  };

  outputs = {
    # nixd-ignore "attribute `self` of argument is not used" warning
    self,
    nixpkgs,
    flake-utils,
    playwright-flake,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      overlay = final: prev: {
        inherit (playwright-flake.packages.${system}) playwright-test playwright-driver;
      };
      pkgs = import nixpkgs {
        inherit system;
        overlays = [overlay];
      };

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
        phases = [ "installPhase" ];
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

          # ── Developer Experience ──
          # direnv + nix-direnv for cached flake evaluation
          # (nix-direnv is small; gcloud/jq should be installed separately
          #  via nix profile or system package manager)
          direnv
          nix-direnv

          python3
          git-filter-repo

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
          nodePackages.sharp
];

        # nix-direnv location — used by .envrc on subsequent loads to
        # source direnvrc without re-evaluating nixpkgs
        NIX_DIRENV = "${pkgs.nix-direnv}";

        shellHook = ''
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
        '';
      };
    });
}
