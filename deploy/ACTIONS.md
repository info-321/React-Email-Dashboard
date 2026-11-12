# Automatic Hostinger deployment

Workflow: [Actions -> Deploy](https://github.com/info-321/React-Email-Dashboard/actions/workflows/deploy.yml).

Pushes to `main` run backend tests, deployment failure/rollback tests, frontend
tests, and a React production build. After verification, the workflow deploys the
tested commit to `/opt/eworkspace` and checks https://eworkspace.ttwindia.com.
You can also select **Run workflow** on the workflow page with branch `main`.

## One-time setup

The deployment uses a separate Actions SSH key, not a personal interactive SSH
key. Only its public key is committed as `deploy/hostinger-actions.pub`.

In this repository's **Settings -> Secrets and variables -> Actions**, configure
these repository secrets (the initial setup can populate these through the API):

| Secret | Value |
| --- | --- |
| `HOSTINGER_HOST` | `147.93.43.76` |
| `HOSTINGER_USER` | `root` |
| `HOSTINGER_SSH_KEY` | The dedicated Actions private key, without a passphrase |
| `HOSTINGER_KNOWN_HOSTS` | The VPS host key entry copied from an already trusted `known_hosts` file |

The private key is encrypted as a GitHub Actions secret. It is not committed or
copied into the Docker image. The runner enforces host key verification and
removes temporary key files when the SSH step ends. If the VPS host key changes,
verify the replacement independently before updating `HOSTINGER_KNOWN_HOSTS`.

Keep the repository variable `HOSTINGER_DEPLOY_READY` set to `false` until the
server key installation below succeeds. Tests still run while deployment is
disabled. This gate represents missing setup, not a per-deployment approval.

On the **VPS**, using your existing interactive SSH connection, run:

```bash
cd /opt/eworkspace
git pull --ff-only
bash deploy/setup-hostinger-actions.sh
```

The installer prints the Actions public key fingerprint and confirms installation.
It preserves existing SSH keys, adds the new public key with `restrict` and a
forced command, and installs `/usr/local/sbin/eworkspace-deploy`. This key can
request only `deploy <full-commit-SHA>`; interactive shells, port forwarding, and
arbitrary SSH commands are disabled for it. Repository write access remains
privileged because the deployment builds and runs the repository's Docker image.

After installation, set the **repository variable** `HOSTINGER_DEPLOY_READY` to
`true` under **Settings -> Secrets and variables -> Actions -> Variables**.
Then open **Actions -> Deploy -> Run workflow**, select `main`, and run it.
Future pushes to `main` deploy automatically after tests pass.

## What a deployment does

1. Acquires an EWorkspace-only lock, verifies the checkout and repository, and
   refuses to overwrite local changes to tracked server files.
2. Fetches `main` without prompting for credentials and fast-forwards to the exact
   tested commit. A superseded commit is skipped instead of replacing newer code.
3. Validates production files and the EWorkspace Compose project/image/port.
4. Saves the running image as `ttw-eworkspace:previous` and builds the replacement
   while the old container continues serving requests.
5. Recreates only the `eworkspace` project's `web` service, waits for container
   health, and checks the local/public health endpoints and unauthenticated 401.
6. Records the active commit in `/opt/eworkspace/.deploy/deployed-sha`.

Container replacement briefly interrupts this app. On activation/health failure,
the script attempts to restore the previous image and saved Compose configuration
and still reports a failed deployment. A build failure leaves the old container
running. Application data is not rolled back; keep independent data backups.

`.env`, `data/`, and `private/` stay on the server and are excluded from Git and
the Docker build. `.deploy/` stores deployment state outside Git. The workflow
does not reload Caddy, change DNS, stop Email Hub, run `docker compose down`, or
prune shared Docker resources. Caddy configuration updates remain a separate task.

Only use this workflow for the original `React-Email-Dashboard` repository and
`eworkspace.ttwindia.com`, not the separate Email Hub repository/application.

## Troubleshooting

- **Deploy job skipped:** verify `HOSTINGER_DEPLOY_READY=true` and branch `main`.
- **Permission denied (publickey):** rerun the one-time installer and confirm that
  the Actions secret matches the public key in this repository.
- **Host key verification failed:** verify the actual VPS fingerprint before
  replacing the trusted host key secret.
- **Tracked files changed:** inspect `git status` on the VPS and resolve local
  source edits. Deployment deliberately does not discard them.
- **Private repository:** if this repository becomes private, configure a separate
  read-only GitHub credential on the VPS so its noninteractive fetch succeeds.
- **Container or health failure:** inspect
  `docker compose -p eworkspace logs --tail=80 web` from `/opt/eworkspace`.
- **Deployment script updates:** the versioned release script updates with each
  deployment. If the entrypoint or public key changes, rerun the one-time installer.

References: [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[Docker Compose deployment](https://docs.docker.com/reference/cli/docker/compose/up/).
