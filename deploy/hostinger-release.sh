#!/usr/bin/env bash
# Called only after the forced SSH command has selected and locked the checkout.
set -Eeuo pipefail

target_sha="${1:?Missing deployment SHA}"
previous_sha="${2:?Missing previous checkout SHA}"
[[ "$target_sha" =~ ^[0-9a-f]{40}$ && "$previous_sha" =~ ^[0-9a-f]{40}$ ]]
cd /opt/eworkspace
[[ "$(git rev-parse HEAD)" == "$target_sha" ]]

for required_file in .env data/emails.json private/workspace_service_account.json; do
  [[ -f "$required_file" ]] || { printf 'Missing production file: %s\n' "$required_file" >&2; exit 1; }
done
install -d -m 0700 .deploy
compose=(docker compose --project-directory /opt/eworkspace --env-file /opt/eworkspace/.env -p eworkspace)
"${compose[@]}" config --quiet

# Pin the target so a configuration typo cannot replace another application's image.
"${compose[@]}" config --format json | python3 -c '
import json, sys
config = json.load(sys.stdin)
web = config["services"]["web"]
assert config["name"] == "eworkspace", "Unexpected Compose project"
assert web["image"] == "ttw-eworkspace:local", "Unexpected image name"
ports = web.get("ports", [])
assert len(ports) == 1 and ports[0]["host_ip"] == "127.0.0.1" and str(ports[0]["published"]) == "8161", "Unexpected host binding"
'

previous_compose="$(mktemp /opt/eworkspace/.deploy/previous-compose.XXXXXX.yaml)"
trap 'rm -f -- "$previous_compose"' EXIT
if [[ -f .deploy/current-compose.yaml ]]; then
  cp .deploy/current-compose.yaml "$previous_compose"
else
  git show "$previous_sha:compose.yaml" > "$previous_compose"
fi

previous_container="$("${compose[@]}" ps -q web)"
previous_image=''
if [[ -n "$previous_container" ]]; then
  previous_image="$(docker inspect --format '{{.Image}}' "$previous_container")"
  docker image tag "$previous_image" ttw-eworkspace:previous
fi

activation_started=false
rollback_on_error() {
  local failure="$?"
  trap - ERR
  if [[ "$activation_started" == true && -n "$previous_image" ]]; then
    printf 'Deployment failed; restoring the previous EWorkspace image.\n' >&2
    docker image tag "$previous_image" ttw-eworkspace:local
    if "${compose[@]}" -f "$previous_compose" up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 web; then
      cp "$previous_compose" .deploy/current-compose.yaml
      printf 'Previous image restored. Deployment remains failed.\n' >&2
    else
      printf 'Automatic rollback failed; inspect only the eworkspace Compose project.\n' >&2
    fi
  fi
  exit "$failure"
}
trap rollback_on_error ERR

# Building does not stop the existing container.
"${compose[@]}" build web
activation_started=true
"${compose[@]}" up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 web
curl --fail --silent --show-error --retry 3 --max-time 20 http://127.0.0.1:8161/api/health \
  | python3 -c 'import json,sys; assert json.load(sys.stdin).get("status") == "ok"'
status="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8161/api/emails)"
[[ "$status" == 401 ]]
curl --fail --silent --show-error --retry 3 --max-time 20 https://eworkspace.ttwindia.com/api/health \
  | python3 -c 'import json,sys; assert json.load(sys.stdin).get("status") == "ok"'

cp compose.yaml .deploy/current-compose.yaml
printf '%s\n' "$target_sha" > .deploy/deployed-sha
trap - ERR
printf 'EWorkspace deployment healthy at commit %s.\n' "$target_sha"
