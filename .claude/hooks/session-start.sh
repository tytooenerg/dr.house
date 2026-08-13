#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web / remote sessions — a local dev machine already has
# its own install workflow (README's "Running locally") and shouldn't have this hook
# silently reinstalling things underneath it.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Installs every JS workspace declared in the root package.json in one pass
# (client, server, e2e, sdks/node) — npm workspaces hoist shared deps, so this is the
# one command that gets `npm run typecheck`/`test`/`build` (root-level, or per -w) ready.
npm install

# The Python SDK (sdks/python) is intentionally NOT an npm workspace — install it
# separately, editable with dev deps, so `python -m pytest` works from that directory
# (see README's CI job). Best-effort: some remote sessions may not have python3/pip
# available, and that shouldn't fail the whole hook — the JS workspaces above are the
# ones every other skill in this repo actually depends on.
if command -v pip >/dev/null 2>&1; then
  pip install -e "$CLAUDE_PROJECT_DIR/sdks/python[dev]" || true
elif command -v pip3 >/dev/null 2>&1; then
  pip3 install -e "$CLAUDE_PROJECT_DIR/sdks/python[dev]" || true
fi
