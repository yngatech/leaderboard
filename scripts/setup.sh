#!/usr/bin/env bash
#
# Prepare a clone or agent worktree for development:
#   - install the pinned toolchain with mise and require the pinned Node major
#   - install dependencies from package-lock.json
#   - install the Playwright Chromium build the browser tests use
#   - in a worktree, copy .dev.vars from the main clone if it has one
#
# Idempotent — safe to re-run: `./scripts/setup.sh`.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

warnings=()

step() { printf '\n==> %s\n' "$1"; }
warn() {
  printf '!!  %s\n' "$1"
  warnings[${#warnings[@]}]="$1"
}

step "Installing the pinned toolchain"
if command -v mise >/dev/null 2>&1; then
  mise trust --quiet mise.toml
  mise install
  # Use the pinned tools for the rest of setup, even before shell activation.
  eval "$(mise env --shell bash)"
  # mise env leaves PATH entries that precede its shims (another version
  # manager's Node, say) ahead of the pinned tools, so put those first.
  PATH="$(mise bin-paths | paste -sd: -):$PATH"
else
  warn "mise is not installed; the Node on PATH must match .node-version (see README.md#toolchain)"
fi

expected=$(tr -d '[:space:]' < .node-version)
if ! command -v node >/dev/null 2>&1; then
  echo "Node is not on PATH. Install mise (https://mise.jdx.dev/getting-started.html) and re-run this script." >&2
  exit 1
fi
actual=$(node --version)
actual=${actual#v}
case "$actual" in
  "$expected" | "$expected".*) ;;
  *)
    echo "This repository requires Node $expected (.node-version), but $(command -v node) is Node $actual." >&2
    echo "Install mise (https://mise.jdx.dev/getting-started.html) and re-run this script, or put Node $expected first on PATH." >&2
    exit 1
    ;;
esac
echo "    node $actual, npm $(npm --version)"

step "Installing dependencies"
npm ci

step "Installing the Playwright Chromium build"
npx playwright install chromium

main_worktree=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
if [ "$main_worktree" != "$repo_root" ]; then
  step "Copying .dev.vars from $main_worktree"
  if [ -e .dev.vars ]; then
    echo "    kept existing .dev.vars"
  elif [ -e "$main_worktree/.dev.vars" ]; then
    cp "$main_worktree/.dev.vars" .dev.vars
    echo "    copied .dev.vars"
  else
    warn "no .dev.vars in $main_worktree; npm run dev needs a GitHub token there (see README.md)"
  fi
fi

if [ ${#warnings[@]} -ne 0 ]; then
  printf '\n==> Warnings\n'
  for warning in "${warnings[@]}"; do
    printf '!!  %s\n' "$warning"
  done
fi

printf '\nSetup complete.\n'
