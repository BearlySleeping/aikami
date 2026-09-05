#!/usr/bin/env bash
# Compatibility launcher for the development sidecar mock.
exec "$(dirname "$0")/llama-server-x86_64-unknown-linux-gnu" "$@"
