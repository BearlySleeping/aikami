{
  description = "Aikami PWA - SvelteKit frontend with Playwright testing";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-flake.url = "github:pietdevries94/playwright-web-flake";
  };

  outputs = { self, nixpkgs, flake-utils, playwright-flake }:
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
            nodejs_24

            # Playwright with Nix-fixed browsers
            playwright-test
          ];

          shellHook = ''
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            echo "Playwright browsers from Nix: $PLAYWRIGHT_BROWSERS_PATH"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          pname = "aikami-pwa";
          version = "0.0.0";

          src = ./.;

          buildInputs = [ pkgs.bun ];

          buildPhase = ''
            bun install
            bun run build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r build/* $out/
          '';

          meta.mainProgram = "index.html";
        };
      });
}
