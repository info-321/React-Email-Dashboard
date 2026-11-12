# Email Hub

React dashboard and Flask API for Google Workspace mailboxes and Gmail/Notion
analytics.

## Run locally on Windows

From the repository root, install backend dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Keep your existing private `server/config.py`. For a fresh checkout, copy
`server/config.example.py` to `server/config.py` and set `ADMIN_USERNAME`,
`ADMIN_PASSWORD`, and `SECRET_KEY` in the terminal environment. The example has
no working credentials. `.env` files are not loaded automatically.

Start the backend:

```powershell
.\.venv\Scripts\python.exe server\app.py
```

In a second terminal:

```powershell
cd client
npm.cmd ci
npm.cmd start
```

Open http://localhost:3000. The React development server proxies `/api` to
http://127.0.0.1:5001. Use the same frontend hostname throughout your session.
Unset `SESSION_COOKIE_SECURE` for local HTTP; use `true` for production HTTPS.

Mailbox access requires `server/workspace_service_account.json` (or the file at
`GOOGLE_APPLICATION_CREDENTIALS`) and Google Workspace domain-wide delegation
for the Gmail scopes in `server/app.py`. This approach is for authorized
Workspace users, not arbitrary personal Gmail accounts.

## Production

See [the VPS migration guide](deploy/README.md). Production uses a React build,
Gunicorn as the WSGI server, and the VPS's existing reverse proxy with HTTPS.
Browser API requests use the website's own domain by default. The optional
build-time `REACT_APP_API_BASE_URL` is an origin without `/api`; it contains no
secrets. A separate API origin also requires `CORS_ORIGINS` and compatible browser
cookie settings. The supplied deployment uses one origin.

The backend enforces an eight-hour authenticated session and CSRF tokens for
mutations. Browser-only login flags are discarded. Email HTML is sanitized with
DOMPurify; styles and forms are removed, so previews can differ from the original
layout. External images may still load.

Keep private configuration, service account keys, saved mailbox addresses, virtual
environments, and generated builds outside Git. An older commit tracked
`server/__pycache__/config.cpython-313.pyc`, containing the configured default
admin password and signing secret. Removing it now does not remove it from
history. Set a new admin password and signing secret before deployment.

## Checks

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s server/tests -v
cd client
npm.cmd test -- --watchAll=false --runInBand
npm.cmd run build
```

Backend tests use dummy configuration, temporary mailbox data, and mocked Gmail
responses. They do not contact Google or read private configuration files.
