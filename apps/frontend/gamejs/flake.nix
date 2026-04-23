{
  description = "GameJS - GodotJS game development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    godotjs-nix.url = "github:snorreks/godotjs-nix";
    playwright-flake.url = "github:pietdevries94/playwright-web-flake";
  };

  outputs = { self, nixpkgs, flake-utils, godotjs-nix, playwright-flake }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlay = final: prev: {
          inherit (playwright-flake.packages.${system}) playwright-test playwright-driver;
        };
        pkgs = import nixpkgs {
          inherit system;
          overlays = [overlay];
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Runtime
            bun

            # For template extraction
            python3

            # Playwright with Nix-fixed browsers
            playwright-test
          ];

          inputsFrom = [
            godotjs-nix.packages.${system}.default
          ];

          shellHook = ''
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            echo "Playwright browsers from Nix: $PLAYWRIGHT_BROWSERS_PATH"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          pname = "gamejs";
          version = "0.0.0";

          src = ./.;

          installPhase = ''
            mkdir -p $out
            cp -r dist/linux/* $out/
          '';

          meta.mainProgram = "game";
        };
      });
}