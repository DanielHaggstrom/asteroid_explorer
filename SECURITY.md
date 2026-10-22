# Security Notes

## Secret Handling
1. This project does not require API keys.
2. No secrets should be committed. `.env*` files are ignored by default.
3. If private integrations are added later, use environment variables and secret managers in CI/CD.
4. Server configuration belongs in root-controlled `/etc/asteroid-explorer`, outside Git and the Docker image. Keep real infrastructure addresses, SSH aliases and private contact details out of deployment templates.
5. The publisher sends allowlisted committed application source/data, excluding private files and operational scripts. Review allowed application source for accidentally embedded credentials before committing.

## Frontend Safety Controls
1. Strict Content Security Policy is defined in `index.html`.
2. The app renders data with `textContent` and avoids unsafe HTML insertion.
3. The browser talks only to same-origin endpoints served by `server.mjs`.

## Backend Safety Controls
1. The server exposes fixed-purpose routes only: `/api/main-belt`, `/api/catalog`, `/api/search`, and `/healthz`.
2. API routes accept `GET`; static assets accept `GET` and `HEAD`.
3. Security headers are set by the server (`nosniff`, referrer policy, permissions policy).
4. Static serving uses an explicit public asset allowlist and traversal protection; repository, server, data and deployment files are not public assets.
5. Search and catalog filters are normalized before being forwarded upstream.

## Operational Hardening Checklist
1. Serve publicly over HTTPS, publishing the Node listener on loopback only. Never bypass certificate validation to work around a route failure.
2. Run non-root with a read-only root filesystem, dropped capabilities, no Docker socket, CPU/memory/PID limits and bounded logs. The prepared sample is bundled read-only; no writable application-data volume is needed.
3. JPL requests are serialized and bounded rather than proportional fan-out work. Keep identification, cache limits, backoff and client limits enabled. Monitor the dependency separately from local readiness.
4. Trust forwarded client IPs only from exact configured proxy addresses; Caddy must overwrite the relevant header. Rate limiting reduces ordinary abuse; it is not DDoS protection or authentication.
5. Use the reviewed root-installed controller/Compose/Dockerfile. Uploads cannot replace them. Extraction rejects links, escapes, hidden files, arbitrary operational files, duplicate paths and excessive sizes.
6. Publish a clean, tested commit, verify checksums/readiness and retain rollback images/source. Update the digest-pinned Node LTS base image through review.
7. Refresh the committed startup sample periodically with `npm run sample:update`. Keep dependencies minimal; this project currently has no runtime package dependencies.
