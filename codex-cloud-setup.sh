#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[codex setup] %s\n' "$*"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="${CODER_REPO_PATH:-}"

if [[ -z "${PROJECT_ROOT}" || ! -f "${PROJECT_ROOT}/package.json" ]]; then
  if candidate="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    PROJECT_ROOT="${candidate}"
  else
    PROJECT_ROOT="${SCRIPT_DIR}"
  fi
fi

cd "${PROJECT_ROOT}"

log "Bootstrapping Connexus in ${PROJECT_ROOT}"
log "Using Node: $(node --version 2>/dev/null || echo 'node not found')"

export http_proxy=
export https_proxy=
export HTTP_PROXY=
export HTTPS_PROXY=
export NO_PROXY=127.0.0.1,localhost,::1

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "Activating pnpm@9 via Corepack"
  corepack prepare pnpm@9 --activate >/dev/null 2>&1 || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "pnpm is required but was not installed"
  exit 1
fi

log "Using pnpm: $(pnpm --version)"

if [[ ! -f ".dev.vars" && -f ".dev.vars.example" ]]; then
  cp .dev.vars.example .dev.vars
  log "Created placeholder .dev.vars (set real secrets via Codex environment variables)."
fi

log "Installing dependencies with pnpm --frozen-lockfile"
pnpm install --frozen-lockfile --prefer-offline

log "Setup complete."
