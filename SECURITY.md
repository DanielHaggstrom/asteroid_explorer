# Security Notes

## Secret Handling
1. This project does not require API keys.
2. No secrets should be committed. `.env*` files are ignored by default.
3. If private integrations are added later, use environment variables and secret managers in CI/CD.

## Frontend Safety Controls
1. Strict Content Security Policy is defined in `index.html`.
2. The app renders data with `textContent` and avoids unsafe HTML insertion.
3. Browser uses same-origin API route (`/api/main-belt`) instead of arbitrary cross-origin calls.

## Backend Safety Controls
1. Proxy endpoint is fixed-purpose (`/api/main-belt`) and does not expose open URL forwarding.
2. Input surface is minimal and methods are restricted (`GET` for API and static files).
3. Security headers are set by the server (`nosniff`, referrer policy, permissions policy).
4. Upstream failures fall back to local snapshot to avoid partial broken UI states.

## Operational Hardening Checklist
1. Serve over HTTPS only.
2. Add response headers in hosting platform:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` with minimal required capabilities
3. Monitor API availability and rate-limit behavior.
4. Keep dependencies minimal; this project currently has none at runtime.
