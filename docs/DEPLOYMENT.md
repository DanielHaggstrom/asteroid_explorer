# Deployment

One Node.js process serves the browser assets and API on port 4173. Charts and the navigator run in visitors' browsers. The prepared startup dataset is committed; live refreshes and query caches are disposable memory state. No database, API key or writable data volume is required.

## Local development

Use Node 24 LTS (Node 22 is also tested), Git, and Python 3.10+ for deployment tooling:

```sh
npm ci --ignore-scripts
npm test
npm run dev
```

Open `http://localhost:4173`. Environment variables come from your shell/runtime; `.env` is not loaded automatically. Never commit private configuration, real SSH aliases or server addresses.

Set `JPL_API_ENABLED=false` and `JPL_REFRESH_ENABLED=false` for offline staging: charts, sample search and sample catalog remain available without outbound calls. Production normally enables both. `JPL_USER_AGENT` identifies the deployment to JPL; use a public project/contact URL. It is not an API token.

## Trusted server bootstrap

An administrator reviews and installs these separately from application releases:

| Repository file | Root-owned server destination |
|---|---|
| `deploy/server.py` | `/usr/local/sbin/asteroid-explorer-deploy` (0755) |
| `deploy/compose.yaml` | `/etc/asteroid-explorer/compose.yaml` (0644 or stricter) |
| `Dockerfile` | `/etc/asteroid-explorer/Dockerfile` (0644 or stricter) |
| `deploy/environment.example` | `/etc/asteroid-explorer/environment` (0640, edited privately) |

Create root-owned `/srv/asteroid-explorer` and `releases` directories, both 0755. Create a real `incoming` directory owned by root, granting write/search only to the authorized SSH publisher's group (for example 0730). Publishing requires an existing SSH connection and `sudo -n` permission for the installed controller. Never add the app user to Docker's group or mount Docker's socket.

The controller rejects group/world-writable trusted files and deployment directories. It never loads Compose, Dockerfiles, controller code or commands from uploaded releases. Updating trusted files is a separate administrator action after review.

The Dockerfile pins an official Node 24 image by digest. Review a new digest in Git, install the reviewed Dockerfile on the server, then publish a new commit. Existing releases cannot silently change their build recipe.

Compose project `asteroid-explorer` runs container `asteroid-explorer-app-1` as UID/GID 10002, publishing only `127.0.0.1:4173`. It uses a read-only filesystem, dropped capabilities, `no-new-privileges`, 16 MiB temporary storage, 512 MiB memory, 0.75 CPU, 64 PIDs and rotating logs. `restart: unless-stopped` covers process and host restarts.

Configure `TRUSTED_PROXY_IPS` with the **exact Docker bridge gateway observed by the container**. Caddy must overwrite `X-Real-IP` with its actual client address. Do not trust arbitrary forwarded headers or broad networks. Verify forged headers cannot change limiter identity. Empty proxy trust is safe, but proxied visitors may share one limiter identity.

## Publish a committed release

After committing, with a clean working tree and Python, Node/npm, Git and OpenSSH on PATH:

```sh
python deploy/publish.py --host YOUR_SSH_ALIAS
```

On Windows, `py -3 deploy/publish.py --host YOUR_SSH_ALIAS` also works if the launcher is installed. The alias is an argument and is never stored in Git.

The PowerShell wrapper locates the Python launcher, a real Python installation, or the user's bundled Codex Python runtime, avoiding the Windows Store alias:

```powershell
.\deploy.ps1 -HostAlias YOUR_SSH_ALIAS
```

It calls the same tested publisher with separate arguments and returns its exit code. Node/npm, Git and OpenSSH still need to be on PATH.

The publisher runs application and deployment tests, verifies the checkout stayed unchanged, then packages **allowlisted files from committed HEAD only**. `.git`, `.env`, ignored/untracked files, deployment scripts, private configuration and arbitrary repository files are excluded. Allowed application source still requires review for accidentally embedded credentials.

It uploads into `/srv/asteroid-explorer/incoming`; the trusted controller verifies SHA256, bounds sizes and checks archive members. Traversal, hidden files, duplicate paths, symlinks, hardlinks, devices and unexpected operational files are rejected. Source is extracted into a new root-owned immutable `releases/FULL_COMMIT_SHA`, built with the trusted Dockerfile, then started.

Compose and local `/healthz` must pass before `/srv/asteroid-explorer/current` changes atomically. Readiness uses the loaded prepared sample, without calling JPL. Failed updates restore the previous release; a failed first installation stops its candidate. The controller retains at least the current/previous releases and three most recent recognized releases/images. Re-publishing the same commit verifies the archive and trusted build-recipe identity, then reuses its image.

Publishing is explicit: there is no server Git key, VPS auto-deploy webhook or polling timer. Uploaded deployment scripts never run as root. Existing Render auto-deploy settings are independent; review them before pushing if that service must remain unchanged.

Uploads are cleaned up afterward. Following an interrupted publish, remove only its specific `incoming/upload-*.tar` after checking it is unused. A deployment file lock serializes publishes and rollbacks.

## DNS, HTTPS and monitoring

Point the chosen public hostname to the VPS address recorded in private server documentation. Example Caddy configuration:

```caddyfile
asteroids.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4173 {
        header_up X-Real-IP {client_ip}
    }
}
```

Validate the full configuration before reloading. Expose the app through HTTPS on 443, not port 4173. The public demo does not need the owner's private SSO; protect every route if using a private staging hostname.

Cloudflare DNS-only connects directly to Caddy's publicly trusted certificate. Proxying adds its edge, but test routes from intended visitors' networks. If proxied, use Full (strict), bypass `/api/*` and `/healthz` in custom cache rules, and avoid cache-everything for dynamic responses. Never bypass a certificate warning to work around ISP filtering. Trust Cloudflare client headers only after Caddy is restricted to verified Cloudflare proxy ranges, with an update procedure.

Monitor local `http://127.0.0.1:4173/healthz`: HTTP 200 and JSON `ok: true` means a nonempty startup sample loaded. Monitor JPL separately; upstream downtime should not take the prepared explorer offline. Do not use search/catalog requests as frequent health checks, consuming API capacity.

## Runtime bounds

- Query cache: 128 entries, 16 MiB serialized budget, 10-minute TTL and periodic expiry; offline catalog fallbacks use a short 30-second TTL.
- Public API traffic: 120 requests/minute globally and 40/client/minute, bounded client tracking, and at most 16 concurrent application operations.
- JPL: one active request, bounded queue of 12, duplicate-request coalescing, a 15-second total deadline including queue/body/retries, maximum 8 MiB response, one retry and shared backoff for throttling/temporary failures.
- Static serving: only the shipped HTML, CSS and frontend JavaScript assets; repository/server/deployment/data files are not downloadable static assets.

These defaults bound ordinary resource usage; they are not a DDoS guarantee. Keep a single upstream-serving app process unless a shared JPL queue is introduced.

The standalone prepared-sample update script is a separate process; avoid running it against JPL while another server process is doing live refreshes. The in-memory queue coordinates only this one application's process.

## Recovery

Inspect the current symlink and retained manifests. Roll back to a retained full commit SHA:

```sh
ssh YOUR_SSH_ALIAS 'sudo -n /usr/local/sbin/asteroid-explorer-deploy --rollback FULL_COMMIT_SHA'
```

The controller verifies image ID/revision, activates and checks readiness before changing the pointer. There is no database migration to reverse. If an image is missing, rebuild from verified source/trusted recipe through a new committed release; do not overwrite an active immutable release.

Back up the trusted controller, `/etc/asteroid-explorer`, Caddy/monitoring configuration, server runbook and active/previous release sources. Git also holds public source and prepared data; runtime caches need no backup. Protect operational backups because future configuration may contain secrets. Existing local VPS backup policy applies; this deployment does not add offsite storage.

## Render compatibility

The earlier Render service can remain until DNS, HTTPS and VPS acceptance are complete. It uses `npm ci --ignore-scripts` and `npm run serve` on a supported Node runtime. Prepared files stay read-only and refreshes stay in memory. Repository changes do not disable or delete the existing Render service; retirement is a separate explicit hosting-account action.
