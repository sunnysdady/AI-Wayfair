#!/usr/bin/env bash
set -euo pipefail
umask 077

project_root="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$project_root"

target_sha="${1:-${DEPLOY_SHA:-}}"
remote="${DEPLOY_REMOTE:-origin}"
branch="${DEPLOY_BRANCH:-production}"
env_file="${ENV_FILE:-.env.production}"
compose_file="docker-compose.production.yml"
production_origin="https://aiwayfair.sunnysdady.com"

fail() {
  echo "Deployment refused: $*" >&2
  exit 1
}

[[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || fail "a full 40-character DEPLOY_SHA is required"
[[ "$remote" =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid Git remote"
[[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "invalid deployment branch"
[[ -f "$env_file" ]] || fail "missing $env_file"

for command_name in git docker curl flock; do
  command -v "$command_name" >/dev/null || fail "missing command: $command_name"
done

exec 9>"$project_root/.git/wayfair-deploy.lock"
flock -n 9 || fail "another deployment is already running"

dirty=()
while IFS= read -r -d '' entry; do
  path="${entry:3}"
  if [[ "$entry" == "?? "* ]] && { [[ "$path" == "DEPLOYED_SHA" ]] || [[ "$path" == backups/* ]]; }; then
    continue
  fi
  dirty+=("$entry")
done < <(git status --porcelain=v1 -z --untracked-files=all)
(( ${#dirty[@]} == 0 )) || fail "server worktree contains unapproved changes"

git fetch --prune "$remote" "$branch"
remote_sha="$(git rev-parse "refs/remotes/$remote/$branch")"
[[ "$target_sha" == "$remote_sha" ]] || fail "target SHA is not the current $remote/$branch head"
git cat-file -e "$target_sha^{commit}" || fail "target SHA is not a commit"

chmod 600 "$env_file"
enable_scheduler="$(awk -F= '$1 == "ENABLE_SCHEDULER" { value=tolower($2); gsub(/[[:space:]\"\047]/, "", value); print value }' "$env_file" | tail -1)"
[[ "$enable_scheduler" == "true" ]] || fail "ENABLE_SCHEDULER must be true in production"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target_tag="${target_sha:0:12}"
previous_sha="$(git rev-parse HEAD)"
if [[ -f DEPLOYED_SHA ]]; then
  recorded_sha="$(tr -d '[:space:]' < DEPLOYED_SHA)"
  if [[ "$recorded_sha" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$recorded_sha^{commit}" 2>/dev/null; then
    previous_sha="$recorded_sha"
  fi
fi
previous_tag="${previous_sha:0:12}"
audit_dir="$project_root/backups/deploy-$timestamp-$target_tag"
mkdir -p "$audit_dir"
printf 'target_sha=%s\nprevious_sha=%s\nstarted_at=%s\n' "$target_sha" "$previous_sha" "$timestamp" > "$audit_dir/release.env"

compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile sync)

table_counts() {
  "${compose[@]}" exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
SELECT format(
  'SELECT %L || ''='' || count(*) FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
SQL
}

object_count() {
  "${compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c '
    mc alias set audit http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc find "audit/$S3_BUCKET" --type f | wc -l
  '
}

wait_for_web() {
  local container_id status attempt
  container_id="$("${compose[@]}" ps -q web)"
  [[ -n "$container_id" ]] || return 1
  for attempt in $(seq 1 36); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && return 0
    sleep 5
  done
  return 1
}

verify_release() {
  local service homepage_status
  wait_for_web || return 1
  for service in web scheduler caddy postgres minio; do
    "${compose[@]}" ps --status running --services | grep -qx "$service" || return 1
  done
  curl --fail --silent --show-error --max-time 15 "$production_origin/api/health" >/dev/null
  homepage_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$production_origin/")"
  [[ "$homepage_status" == "401" ]]
}

rollback_ready=false
on_error() {
  local exit_code=$?
  trap - ERR
  set +e
  printf 'failed_at=%s\ndatabase_rollback=not_attempted\n' "$(date -u +%Y%m%dT%H%M%SZ)" >> "$audit_dir/release.env"
  if [[ "$rollback_ready" == "true" ]]; then
    echo "Deployment failed; restoring application release $previous_sha. Database migrations are not rolled back automatically." >&2
    git switch --detach "$previous_sha"
    if ! docker image inspect "wayfair-ai-ops-web:$previous_tag" >/dev/null 2>&1; then
      APP_IMAGE_TAG="$previous_tag" "${compose[@]}" build web scheduler
    fi
    APP_IMAGE_TAG="$previous_tag" "${compose[@]}" up -d --remove-orphans
    wait_for_web
  fi
  exit "$exit_code"
}
trap on_error ERR

"${compose[@]}" config --quiet
table_counts > "$audit_dir/table-counts-before.txt"
object_count > "$audit_dir/object-count-before.txt"
"${compose[@]}" exec -T postgres sh -lc 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$audit_dir/postgres-before.dump"

git switch --detach "$target_sha"
rollback_ready=true
compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile sync)

echo "Deploying release $target_sha from $remote/$branch"
APP_IMAGE_TAG="$target_tag" "${compose[@]}" config --quiet
APP_IMAGE_TAG="$target_tag" "${compose[@]}" build --pull web scheduler migrate
APP_IMAGE_TAG="$target_tag" "${compose[@]}" --profile tools run --rm migrate
APP_IMAGE_TAG="$target_tag" "${compose[@]}" up -d --remove-orphans
verify_release
APP_IMAGE_TAG="$target_tag" "${compose[@]}" exec -T scheduler node scripts/run-scheduled-sync.mjs
table_counts > "$audit_dir/table-counts-after.txt"
object_count > "$audit_dir/object-count-after.txt"

deployed_tmp="$(mktemp "$project_root/.DEPLOYED_SHA.XXXXXX")"
printf '%s\n' "$target_sha" > "$deployed_tmp"
chmod 644 "$deployed_tmp"
mv "$deployed_tmp" DEPLOYED_SHA
printf 'completed_at=%s\nstatus=success\n' "$(date -u +%Y%m%dT%H%M%SZ)" >> "$audit_dir/release.env"
rollback_ready=false
trap - ERR

"${compose[@]}" ps
echo "Deployment verified: $target_sha"
