#!/usr/bin/env bash
# Installed once at /usr/local/sbin/eworkspace-deploy as the SSH forced command.
set -Eeuo pipefail

if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  printf 'Only deploy followed by a full main-branch commit SHA is allowed.\n' >&2
  exit 2
fi
target_sha="${BASH_REMATCH[1]}"

cd /opt/eworkspace
[[ "$(git rev-parse --show-toplevel)" == /opt/eworkspace ]]
case "$(git remote get-url origin)" in
  https://github.com/info-321/React-Email-Dashboard.git|git@github.com:info-321/React-Email-Dashboard.git) ;;
  *) printf 'Unexpected repository; refusing deployment.\n' >&2; exit 1 ;;
esac

# Serialize SSH/manual deploys as well as GitHub Actions runs.
install -d -m 0700 /opt/eworkspace/.deploy
exec 9>/opt/eworkspace/.deploy/deploy.lock
flock -w 900 9

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  printf 'Tracked server files have local changes. Resolve them before deploying.\n' >&2
  exit 1
fi

GIT_TERMINAL_PROMPT=0 git fetch --no-tags origin main
if [[ "$target_sha" != "$(git rev-parse refs/remotes/origin/main)" ]]; then
  printf 'A newer main commit exists; skipping this superseded deployment.\n'
  exit 0
fi

previous_sha="$(git rev-parse HEAD)"
git merge --ff-only "$target_sha"
bash /opt/eworkspace/deploy/hostinger-release.sh "$target_sha" "$previous_sha"
