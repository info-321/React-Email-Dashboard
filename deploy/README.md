# Deploy EWorkspace to Hostinger with Docker and Caddy

This is the original `info-321/React-Email-Dashboard` project. Its production
hostname is **eworkspace.ttwindia.com**. The existing `/opt/emailhub` deployment
uses a different repository (`React-Email-Dashboard-2`) and must remain separate.

| Application | Checkout | Compose project | Host listener |
| --- | --- | --- | --- |
| Existing Email Hub | `/opt/emailhub` | Existing project | `127.0.0.1:8160` |
| This EWorkspace app | `/opt/eworkspace` | `eworkspace` | `127.0.0.1:8161` |

The new image builds React and serves it through Flask/Gunicorn. Caddy proxies
the entire hostname to the new container. No additional public port or web server
installation is required. All commands below run on the Ubuntu VPS as root unless
explicitly labeled Windows. Keep PythonAnywhere available throughout migration.

## 1. Verify a free port and clone the correct repository

Inspect without changing the existing applications:

```bash
ss -ltnp 'sport = :8161'
docker ps --format 'table {{.Names}}\t{{.Ports}}'
grep -nE 'emailhub|eworkspace|8160|8161|^[[:space:]]*import[[:space:]]' /etc/caddy/Caddyfile
```

Port 8161 should have no listener. If occupied, choose a free port and update both
`EWORKSPACE_PORT` and `deploy/Caddyfile.eworkspace` consistently. Use a dedicated,
previously unused checkout; if `/opt/eworkspace` exists, inspect it before proceeding.

```bash
git clone https://github.com/info-321/React-Email-Dashboard.git /opt/eworkspace
cd /opt/eworkspace
git remote get-url origin
git log -1 --oneline
```

Run one stage at a time and stop on errors. Use an authorized read-only deploy key
or GitHub credential flow if the repository requires authentication. Keep access
tokens out of clone URLs and shell history.

## 2. Configure this project independently

Create these new project directories and copy the example environment once:

```bash
cd /opt/eworkspace
install -d -o 10001 -g 10001 -m 0700 /opt/eworkspace/data
install -d -m 0700 /opt/eworkspace/private
cp -n .env.example .env
chmod 600 .env
nano .env
```

Set `ADMIN_USERNAME`, a new unique `ADMIN_PASSWORD`, and a new random `SECRET_KEY`.
For example, generate the signing secret with
`python3 -c 'import secrets; print(secrets.token_hex(32))'`. The example leaves
credentials empty so Compose refuses to start before they are configured. Keep
these values private. Use single quotes around environment values containing
`$` or `#` to preserve them. Compose loads `.env`; the application does not load
dotenv files on its own.

Do not reuse the old default password or signing secret: the original repository
historically tracked compiled config bytecode containing those defaults.

If needed, migrate this project's Notion credentials and `NOTION_PROP_*` schema
mappings from its PythonAnywhere config into this `.env`. The runtime image uses
`server/config.example.py` as environment-based configuration; the private local
`server/config.py` is excluded from the Docker build context. Session cookies are
HTTPS-only in this deployment.

## 3. Transfer this project's credentials and data

Use fresh copies from the original project's PythonAnywhere deployment:

| Private file | New VPS destination |
| --- | --- |
| `workspace_service_account.json` | `/opt/eworkspace/private/workspace_service_account.json` |
| `emails.json` | `/opt/eworkspace/data/emails.json` |

Do not copy or mount another project's data directory. The Gmail messages remain
in Google Workspace; `emails.json` contains this dashboard's saved addresses.
Retain the existing Google Workspace delegation and verify any network restrictions.

For example, when the correct production copies are available locally, transfer
them from **Windows PowerShell**, starting in this local repository:

```powershell
scp -i "$env:USERPROFILE\.ssh\ttw_emailhub_vps_ed25519" .\server\workspace_service_account.json root@147.93.43.76:/opt/eworkspace/private/workspace_service_account.json
scp -i "$env:USERPROFILE\.ssh\ttw_emailhub_vps_ed25519" .\server\emails.json root@147.93.43.76:/opt/eworkspace/data/emails.json
```

The existing SSH key can access the VPS; it does not need to be recreated for
each project. Share only public keys, never the private key or its passphrase.

Back on the **VPS**, check ownership and permissions:

```bash
chown 10001:10001 /opt/eworkspace/data /opt/eworkspace/data/emails.json /opt/eworkspace/private/workspace_service_account.json
chmod 700 /opt/eworkspace/data
chmod 600 /opt/eworkspace/data/emails.json /opt/eworkspace/private/workspace_service_account.json
```

The container uses UID/GID 10001. The credentials file is mounted read-only and
the data directory remains writable. Neither is embedded in the image or Git.
If starting with no saved addresses intentionally, create `data/emails.json`
containing `[]` before the ownership step. An absent credentials file must be
restored before starting the container.

## 4. Build and test the new container

```bash
cd /opt/eworkspace
docker compose -p eworkspace config --quiet
docker compose -p eworkspace build
docker compose -p eworkspace up -d --no-deps web
docker compose -p eworkspace ps
curl -i --max-time 20 http://127.0.0.1:8161/api/health
curl -sS --max-time 20 -o /dev/null -w 'Protected API: HTTP %{http_code}\n' http://127.0.0.1:8161/api/emails
```

The new project's health JSON is `{"status":"ok"}`. The protected API must return
401 without login. Check the root page and React assets too. If startup fails:

```bash
docker compose -p eworkspace logs --tail=80 web
```

Keep secrets out of shared output. These Compose commands target only the new
`eworkspace` project. Use the correct directory and `-p eworkspace` for future
updates. Avoid host-wide Docker cleanup or stopping other Compose projects.

The image runs Gunicorn as a non-root user with a read-only filesystem, a writable
temporary directory, and dropped capabilities. One synchronous worker serializes
the JSON registry's read/modify/write operations; long analytics requests can
delay other requests. Move that registry to a transactional database before
increasing workers/threads for heavier use.

## 5. Give EWorkspace its own Caddy site

Take a VPS snapshot or backup and back up the current Caddyfile:

```bash
cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup-$(date +%Y%m%d-%H%M%S)"
nano /etc/caddy/Caddyfile
```

Add the separate site block from `deploy/Caddyfile.eworkspace`:

```caddyfile
eworkspace.ttwindia.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8161
}
```

Preserve all existing applications' blocks. If earlier instructions added
`eworkspace.ttwindia.com` as an alias on the Email Hub block pointing to 8160,
remove only that alias from the old block before adding this separate block.
If another EWorkspace block already exists, update it instead of creating a
duplicate. Inspect imported configuration files too if the Caddyfile uses imports.

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Only after successful validation:

```bash
systemctl reload caddy
```

Caddy certificate issuance requires the new hostname's DNS to reach this VPS.
It may retry until the next step propagates. Keep the existing Caddy process and
its certificate storage; reloading adds this site's configuration.

## 6. Move only EWorkspace's DNS from PythonAnywhere

The authoritative DNS is Cloudflare. In `ttwindia.com` -> DNS -> Records,
replace the `eworkspace` CNAME pointing at
`webapp-2846212.pythonanywhere.com` with:

| Field | Value |
| --- | --- |
| Type | A |
| Name | eworkspace |
| IPv4 address | 147.93.43.76 (verify against the VPS dashboard) |
| Proxy status | DNS only initially |
| TTL | Auto |

Retain the old CNAME value for rollback. Update conflicting records for this
hostname only. Preserve the Email Hub record, other websites, nameservers, and
MX/SPF/DKIM/DMARC records. Once DNS reaches the VPS and ports 80/443 are available,
Caddy can issue and renew the HTTPS certificate.

From **Windows PowerShell**:

```powershell
Resolve-DnsName eworkspace.ttwindia.com -Type A
```

When DNS-only propagation finishes, it should return `147.93.43.76`. On the VPS:

```bash
curl -i --max-time 20 https://eworkspace.ttwindia.com/api/health
curl -sS --max-time 20 -o /dev/null -w 'Protected API: HTTP %{http_code}\n' https://eworkspace.ttwindia.com/api/emails
```

Expect this project's health JSON and HTTP 401 before login. For certificate or
proxy errors, inspect `journalctl -u caddy -n 50 --no-pager`.

## 7. Validate migration and retain rollback

In an incognito browser, test login, saved addresses, mailbox messages, search,
attachments, analytics, refresh/session restoration, and logout. Send a test
message only to an approved recipient. Check the existing Email Hub and other
applications still work. Changes to saved addresses on PythonAnywhere during
testing require a final data sync at cutover; coordinate a brief write freeze.

Keep PythonAnywhere and its old DNS target for rollback until functionality,
production data, HTTPS, backups, and credential rotation are verified. Cancel its
subscription after a monitoring period. Back up this project's `.env`, private
key file, and data securely, independently of the other applications.

For updates, keep a known-good image/revision, pull this repository with
`git pull --ff-only`, rebuild, then run
`docker compose -p eworkspace up -d --no-deps web` from `/opt/eworkspace`.
Container replacement briefly interrupts this app; use staged releases if you
need uninterrupted availability. Do not publish private files when syncing Git.

For automatic deployment of future pushes to `main`, see [GitHub Actions setup](ACTIONS.md).

References: [Docker project isolation](https://docs.docker.com/compose/how-tos/project-name/),
[Caddy site blocks](https://caddyserver.com/docs/caddyfile/concepts),
[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Cloudflare DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/).
