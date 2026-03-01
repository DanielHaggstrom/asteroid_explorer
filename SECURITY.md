# Security Notes

## Secret Handling
1. This project does not require API keys.
2. No secrets should be committed. `.env*` files are ignored by default.
3. If private integrations are added later, use environment variables and secret managers in CI/CD.

## Frontend Safety Controls
1. Strict Content Security Policy is defined in `index.html`.
2. The app renders data with `textContent` and avoids unsafe HTML insertion.
3. The browser talks only to same-origin endpoints served by `server.mjs`.

## Backend Safety Controls
1. The server exposes fixed-purpose routes only: `/api/main-belt`, `/api/catalog`, `/api/search`, and `/healthz`.
2. Methods are restricted to `GET` for API routes and static assets.
3. Security headers are set by the server (`nosniff`, referrer policy, permissions policy).
4. Static-path resolution is normalized to block path traversal.
5. Search and catalog filters are normalized before being forwarded upstream.

## Operational Hardening Checklist
1. Serve over HTTPS only.
2. Keep the public deployment on a Node host with outbound access restricted to what the service actually needs.
3. Monitor NASA/JPL API availability and latency.
4. Refresh the committed startup sample periodically with `npm run sample:update`.
5. Keep dependencies minimal; this project currently has no runtime package dependencies.
