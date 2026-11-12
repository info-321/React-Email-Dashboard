# React client

See the [project README](../README.md) for setup and
[VPS migration guide](../deploy/README.md) for production.

```powershell
npm.cmd ci
npm.cmd start
```

The development server runs on port 3000 and proxies `/api` to Flask on port
5001. `npm.cmd run build` generates `client/build` for production. Production API
requests use the site's own origin by default. Deploy frontend and backend from
the same commit because API mutations require session cookies and CSRF headers.
