#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[codex maintenance] %s\n' "$*"
}

discover_repo_root() {
  local start="$1"
  while [[ -n "${start}" && "${start}" != "/" ]]; do
    if [[ -f "${start}/package.json" && -f "${start}/src/worker.tsx" ]]; then
      printf '%s' "${start}"
      return 0
    fi
    local next
    next="$(dirname "${start}")"
    if [[ "${next}" == "${start}" ]]; then
      break
    fi
    start="${next}"
  done
  return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

PROJECT_ROOT="${CODER_REPO_PATH:-}"

if [[ -n "${PROJECT_ROOT}" && -d "${PROJECT_ROOT}" ]]; then
  if [[ ! -f "${PROJECT_ROOT}/package.json" ]]; then
    if candidate="$(discover_repo_root "${PROJECT_ROOT}")"; then
      PROJECT_ROOT="${candidate}"
    fi
  fi
fi

if [[ -z "${PROJECT_ROOT}" || ! -d "${PROJECT_ROOT}" ]]; then
  if candidate="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    PROJECT_ROOT="${candidate}"
  fi
fi

if [[ -z "${PROJECT_ROOT}" || ! -d "${PROJECT_ROOT}" ]]; then
  for base in "${SCRIPT_DIR}" "$(pwd)" "${HOME:-}" /workspace /workspaces /repo; do
    [[ -d "${base}" ]] || continue
    if candidate="$(discover_repo_root "${base}")"; then
      PROJECT_ROOT="${candidate}"
      break
    fi
    for child in "${base}"/*; do
      [[ -d "${child}" ]] || continue
      if candidate="$(discover_repo_root "${child}")"; then
        PROJECT_ROOT="${candidate}"
        break 2
      fi
    done
  done
fi

if [[ -z "${PROJECT_ROOT}" || ! -d "${PROJECT_ROOT}" ]]; then
  log "Unable to determine project root; searched ${SCRIPT_DIR}, $(pwd), ${HOME:-}, /workspace, /workspaces, /repo."
  exit 1
fi

cd "${PROJECT_ROOT}"

log "Refreshing cached Codex container for Connexus"
log "Git HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false

if [[ -f package-lock.json ]]; then
  log "Synchronising dependencies with npm ci"
  npm ci --prefer-offline
else
  log "Synchronising dependencies with npm install"
  npm install --no-audit --prefer-offline
fi

if npm run clean:vite --if-present; then
  log "Cleared stale Vite cache"
fi

if npm run generate --if-present; then
  log "Regenerated Wrangler types"
fi

log "Maintenance complete."
