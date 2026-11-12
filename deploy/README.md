# Migrate PythonAnywhere to an existing Ubuntu VPS

These are templates, not an automatic installer. First inspect the running
applications, listening ports, reverse proxy, certificate manager, Docker
containers, and available resources. Take a VPS backup/snapshot before changes.
Confirm the hostname: `emailhub.ttwindia.com` and `eworkspace.ttwindia.com` are
different names. The Nginx example assumes the first.

Preserve existing web server configurations and other domains' DNS records. If a
proxy or control panel already owns ports 80/443, add this app through that setup.
A Docker-based server may need a container deployment instead of this service.

## 1. Stage an isolated checkout

After verifying the layout, use a new, dedicated directory:

```bash
sudo git clone https://github.com/info-321/React-Email-Dashboard.git /srv/emailhub
cd /srv/emailhub
```

For a private repo, use an authorized read-only deploy key or GitHub credential
flow. Keep tokens out of repository URLs, command history, and app configuration.
Install missing Git, `python3-venv`, pip, and a supported Node.js/npm version using
the server's existing conventions. Check other apps before changing shared runtimes.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd client
npm ci
npm test -- --watchAll=false --runInBand
npm run build
cd ..
.venv/bin/python -m unittest discover -s server/tests -v
```

Run installation/build steps as an appropriate deployment user with write access
to this checkout. The compiled React build is served by the proxy. Flask can also
serve `client/build` directly, or the old PythonAnywhere `server/static` layout.
`FRONTEND_BUILD_DIR` overrides the fallback path. If the old `server/static/index.html`
exists it takes precedence, so set the override when changing that layout.

## 2. Restore private configuration and data

Create the unprivileged service user `emailhub`, `/etc/emailhub`, and
`/var/lib/emailhub` if absent. The user must read the checkout and credentials and
write the data directory. The proxy needs read access to `client/build` and
access to the runtime socket.

Copy `server/config.example.py` to `server/config.py` for an environment-based
installation, or securely transfer the current production config and preserve
custom Notion schema mappings. Copy `emailhub.env.example` to
`/etc/emailhub/emailhub.env`, replace all credential placeholders, and keep
`SESSION_COOKIE_SECURE=true` for HTTPS. systemd reads this file; the app does not
parse dotenv files. Keep it owned by root with mode `0600`.

Generate an independent signing secret, e.g.
`python3 -c 'import secrets; print(secrets.token_hex(32))'`, and use a unique admin
password. Never commit these values. Environment values override the legacy
config's admin credentials and signing secret.

Transfer these private production files securely, outside Git:

| PythonAnywhere file | VPS destination |
| --- | --- |
| `workspace_service_account.json` | `/etc/emailhub/workspace_service_account.json` |
| `emails.json` | `/var/lib/emailhub/emails.json` |

Keep the service account key owned by `emailhub` with mode `0600`; its parent
directory must allow that user to traverse it. Keep the data directory owned by
`emailhub` with mode `0700`. Restore optional Notion settings/property mappings.
Verify Workspace delegation and any network restrictions. Gmail messages stay
in Google Workspace; `emails.json` stores saved dashboard mailbox addresses.

If the old site remains writable during testing, recopy its final `emails.json`
at cutover or temporarily freeze saved-address changes. Keep production data
outside the checkout across future Git pulls.

## 3. Start the WSGI service

Review `emailhub.service`; adapt paths, users, and groups. It assumes an Ubuntu
proxy worker in group `www-data`. Install it as
`/etc/systemd/system/emailhub.service` after creating the user and directories:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now emailhub
sudo systemctl status emailhub --no-pager
sudo curl --unix-socket /run/emailhub/gunicorn.sock http://localhost/api/health
```

Gunicorn runs as the service user and binds only a Unix socket. One synchronous
worker serializes requests while mailbox storage uses JSON read/modify/write
operations. Long analytics requests can delay other requests. Before adding
workers/threads or heavy traffic, use a transactional database or cross-process
locking. This starting configuration suits a small internal deployment.

Use Gunicorn in production; Flask debug mode and `npm start` are for development.

## 4. Add the domain to the existing proxy

For an existing Nginx installation, review `nginx.emailhub.conf` and add it as a
separate site. Confirm no existing site claims the hostname. Validate with
`sudo nginx -t` before reloading. Adapt the configuration for Apache, Caddy,
Traefik, Docker, or a panel instead if applicable.

Install a certificate through the VPS's existing HTTPS/renewal mechanism. The
template is HTTP-only for initial routing checks: add HTTPS and an HTTP-to-HTTPS
redirect before public cutover and login testing with secure cookies. Certificate
verification may need a DNS challenge or brief DNS change. Configure login rate
limiting through the existing proxy's supported mechanism.

Test against the VPS before DNS cutover with a local hosts override or
`curl --resolve`. Once a trusted certificate is installed:

```bash
curl --resolve emailhub.ttwindia.com:443:VPS_IP https://emailhub.ttwindia.com/api/health
curl --resolve emailhub.ttwindia.com:443:VPS_IP https://emailhub.ttwindia.com/api/emails
```

Health should return status `ok`; emails should return HTTP 401 before login.
Verify login, refresh/session restoration, saved mailbox management, mailbox
listing/search, attachments, analytics, and logout. Send only to an approved test
recipient. Check the existing applications still work.

## 5. Cut over DNS and retain rollback

At the authoritative DNS provider, update only the confirmed subdomain's A record
to the current VPS IPv4. Update/remove conflicting CNAME/AAAA records for that
same name as appropriate. Preserve apex, other subdomains, and MX/SPF/DKIM/DMARC
records. Verify HTTPS, access, and certificate renewal after propagation. Retain
the old DNS value and PythonAnywhere deployment for rollback. Cancel the old
subscription after validation and a monitoring period.

## Updates and logs

Keep a known-good Git revision and build for rollback. In this checkout layout,
`git pull --ff-only`, dependency installation, and rebuilding modify files in
place. Schedule a maintenance window or use release directories with an atomic
switch if uninterrupted availability is required. Run checks and rebuild before
activating the new version. Restart only `emailhub` after a tested update.

```bash
sudo journalctl -u emailhub -n 100 --no-pager
```

Back up credentials, environment, and saved addresses securely. Users sign in
again after migration. Historical tracked config bytecode remains in older Git
commits and contains the configured default admin password and signing secret.
Replace both before launch; do not reuse these defaults on the VPS.

References: [Flask/Gunicorn](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/),
[Nginx routing](https://nginx.org/en/docs/http/request_processing.html),
[Hostinger DNS](https://www.hostinger.com/support/4468886-how-to-manage-a-records-at-hostinger/).
