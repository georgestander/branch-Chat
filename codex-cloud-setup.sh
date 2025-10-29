#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[codex setup] %s\n' "$*"
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

log "Bootstrapping Connexus environment in ${PROJECT_ROOT}"
log "Using Node: $(node --version 2>/dev/null || echo 'node not found')"
npm --version >/dev/null 2>&1 && log "Using npm: $(npm --version)"

if command -v corepack >/dev/null 2>&1; then
  log "Enabling Corepack shims"
  corepack enable >/dev/null 2>&1 || true
fi

# Ensure the agent has a vars file so Wrangler builds don't fail early.
if [[ ! -f ".dev.vars" && -f ".dev.vars.example" ]]; then
  cp .dev.vars.example .dev.vars
  log "Created placeholder .dev.vars (set real secrets via Codex environment variables)."
fi

export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false

if [[ -f package-lock.json ]]; then
  log "Installing dependencies with npm ci"
  npm ci
else
  log "Installing dependencies with npm install"
  npm install --no-audit --prefer-offline
fi

if npm run generate --if-present; then
  log "Generated Wrangler types (npm run generate)"
fi

if npm run types --if-present; then
  log "Type-checked project (npm run types)"
fi

log "Building production bundles (npm run build)"
npm run build

log "Setup complete."
