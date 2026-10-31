#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Please install Node.js 22.12+ (or a supported newer LTS) and npm.'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
npm run dev -- --open
