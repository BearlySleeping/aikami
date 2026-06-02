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
          chromium
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
        '';
      };
    });
}
