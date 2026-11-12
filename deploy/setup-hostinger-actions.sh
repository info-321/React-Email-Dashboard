#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$EUID" == 0 ]] || { printf 'Run this installer as root on the VPS.\n' >&2; exit 1; }
cd /opt/eworkspace
[[ "$(git rev-parse --show-toplevel)" == /opt/eworkspace ]]
public_key_file=/opt/eworkspace/deploy/hostinger-actions.pub
ssh-keygen -l -f "$public_key_file"
public_key="$(cat "$public_key_file")"
[[ "$public_key" == ssh-ed25519\ * ]]
key_data="$(awk '{print $2}' "$public_key_file")"
restricted_key="restrict,command=\"/usr/local/sbin/eworkspace-deploy\" $public_key"

install -d -m 0700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
if grep -Fq -- "$key_data" /root/.ssh/authorized_keys; then
  if ! grep -Fxq -- "$restricted_key" /root/.ssh/authorized_keys; then
    printf 'This deployment key already exists with different options; inspect it before proceeding.\n' >&2
    exit 1
  fi
else
  printf '\n%s\n' "$restricted_key" >> /root/.ssh/authorized_keys
fi

install -o root -g root -m 0755 deploy/hostinger-entrypoint.sh /usr/local/sbin/eworkspace-deploy
install -d -m 0700 /opt/eworkspace/.deploy
if [[ ! -f .deploy/current-compose.yaml ]]; then
  cp compose.yaml .deploy/current-compose.yaml
fi
printf 'GitHub Actions deployment key installed for EWorkspace only.\n'
printf 'Existing SSH keys and other applications were preserved.\n'
