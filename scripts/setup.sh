#!/usr/bin/env bash
# Set up a clone or worktree: pinned Node via mise, dependencies, Playwright Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v mise >/dev/null; then
  mise trust --quiet mise.toml
  mise install
  eval "$(mise env --shell bash)"
  # Put the pinned Node ahead of any other Node already on PATH (e.g. vite-plus's).
  PATH="$(mise bin-paths | paste -sd: -):$PATH"
else
  echo "warning: mise not installed; using Node $(node --version), pin is $(cat .node-version)" >&2
fi

npm ci
npx playwright install chromium

# In a worktree, copy .dev.vars from the main clone.
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
[ -e .dev.vars ] || [ ! -e "$main/.dev.vars" ] || cp "$main/.dev.vars" .dev.vars
