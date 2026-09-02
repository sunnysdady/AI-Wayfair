#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

remote="${DEPLOY_REMOTE:-origin}"
branch="${DEPLOY_BRANCH:-production}"
host="${DEPLOY_HOST:-wayfair-production}"

fail() {
  echo "Release refused: $*" >&2
  exit 1
}

[[ "$remote" =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid Git remote"
[[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "invalid deployment branch"
[[ "$host" =~ ^[A-Za-z0-9._@-]+$ ]] || fail "invalid SSH host"

for command_name in git ssh; do
  command -v "$command_name" >/dev/null || fail "missing command: $command_name"
done

[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "local worktree must be clean"
target_sha="$(git rev-parse HEAD)"
[[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || fail "unable to resolve a full commit SHA"

git fetch --prune "$remote" "$branch"
remote_ref="refs/remotes/$remote/$branch"
remote_sha="$(git rev-parse "$remote_ref")"
git merge-base --is-ancestor "$remote_sha" "$target_sha" || fail "$remote/$branch cannot be advanced with a fast-forward"

if [[ "$remote_sha" != "$target_sha" ]]; then
  git push "$remote" "$target_sha:refs/heads/$branch"
fi

verified_sha="$(git ls-remote --heads "$remote" "refs/heads/$branch" | awk 'NR == 1 { print $1 }')"
[[ "$verified_sha" == "$target_sha" ]] || fail "remote production branch verification failed"

echo "Releasing $target_sha to $host"
ssh -o BatchMode=yes -o IdentitiesOnly=yes "$host" \
  "sudo -n /usr/local/sbin/wayfair-deploy '$target_sha'"

echo "Release completed: $target_sha"
