#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[codex maintenance] %s\n' "$*"
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

log "Refreshing Codex container in ${PROJECT_ROOT}"
log "Git HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

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
  corepack prepare pnpm@9 --activate >/dev/null 2>&1 || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "pnpm is required but was not installed"
  exit 1
fi

log "Using pnpm: $(pnpm --version)"

log "Synchronising dependencies with pnpm --frozen-lockfile"
pnpm install --frozen-lockfile --prefer-offline

log "Maintenance complete."
