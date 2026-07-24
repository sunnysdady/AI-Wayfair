#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

env_file="${ENV_FILE:-.env.production}"
compose_file="docker-compose.production.yml"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file. Copy .env.example and add production values." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy a dirty Git worktree." >&2
  exit 1
fi

chmod 600 "$env_file"
export APP_IMAGE_TAG="${APP_IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"
echo "Deploying release $APP_IMAGE_TAG"

compose=(docker compose --env-file "$env_file" -f "$compose_file")
"${compose[@]}" config --quiet
"${compose[@]}" build --pull web scheduler migrate
"${compose[@]}" --profile tools run --rm migrate
enable_scheduler="$(awk -F= '$1 == "ENABLE_SCHEDULER" { print tolower($2) }' "$env_file" | tail -1)"
if [[ "$enable_scheduler" == "true" ]]; then
  "${compose[@]}" --profile sync up -d --remove-orphans
else
  "${compose[@]}" --profile sync stop scheduler >/dev/null 2>&1 || true
  "${compose[@]}" up -d --remove-orphans
fi
"${compose[@]}" ps
