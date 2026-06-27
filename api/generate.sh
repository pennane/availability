#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Go codegen
echo "Generating Go types..."
oapi-codegen -config "$SCRIPT_DIR/oapi-codegen.yaml" "$SCRIPT_DIR/openapi.yaml"

# TypeScript codegen
echo "Generating TypeScript types..."
cd "$SCRIPT_DIR" && pnpm run generate

echo "Done."
