# Asteroid Belt Explorer

Browser-based dashboard for visual and intuitive exploration of main-belt asteroids using official NASA/JPL public API data.

## Live App
- Public VPS deployment: https://asteroids.classroom-fox.com/
- Legacy Render fallback: https://asteroid-explorer.onrender.com/
- Health check: `/healthz` on the deployment being used.

The app also supports a hardened VPS deployment with explicit publishing and recovery on failed readiness. See [deployment instructions](docs/DEPLOYMENT.md). Render free instances can cold-start after inactivity.

## What The App Does
1. Shows a prepared sample of main-belt asteroids immediately at startup for fast first paint.
2. Uses that sample for charts, KPIs, and the belt navigator.
3. Uses the live JPL APIs for full-catalog pagination, sorting, filtering, and object search.
4. Pins a searched or table-selected object into the live sample so it appears on the map and charts even if it was not part of the prepared sample.
5. Refreshes the loaded sample in memory in the background while the service is running.

## Key Views
1. Population by size category.
2. Semi-major axis vs eccentricity scatter plot.
3. Semi-major axis density histogram with Kirkwood resonance guides.
4. True-anomaly histogram.
5. Belt navigator map.
6. Full-catalog browser with server-side pagination.
7. Selected-object details panel.

More detail:
- [Visualization notes](docs/VISUALIZATIONS.md)
- [Data-source notes](docs/DATA_SOURCES.md)
- [Deployment notes](docs/DEPLOYMENT.md)
- [Roadmap](docs/ROADMAP.md)

## Data Model
This project uses a prepared dataset for fast startup and bounded live requests for exploration beyond that sample.

1. `data/main-belt-startup.json`
- Prepared startup sample committed into the repo.
- Includes a fixed set of non-negotiable scientifically important bodies.
- Used for initial charts, KPIs, and the belt navigator.

2. Live JPL APIs
- `GET /api/catalog` pages through the full main-belt catalog via NASA/JPL.
- `GET /api/search` resolves named bodies and designations via NASA/JPL.
- Runtime refresh updates only the currently loaded sample in memory.

Reference APIs:
- SBDB Query API: `https://ssd-api.jpl.nasa.gov/sbdb_query.api`
- SBDB Object API: `https://ssd-api.jpl.nasa.gov/sbdb.api`

## Local Run
Requirements:
1. Node.js 24 LTS recommended (Node 22 is also tested).

Commands:
```bash
npm ci --ignore-scripts
npm test
npm run dev
```

Then open:
- `http://localhost:4173`

## Refresh The Prepared Sample
Regenerate `data/main-belt-startup.json` with the current JPL data:

```bash
npm run sample:update
```

Optional flags:
```bash
node scripts/update_startup_sample.mjs --size=12000
node scripts/update_startup_sample.mjs --commit
```

What this command does:
1. Pulls the current main-belt count from JPL.
2. Re-fetches all required core bodies from `config/startup-sample-core-bodies.json`.
3. Fills the rest of the startup sample from random JPL catalog windows.
4. Writes the updated prepared sample back to `data/main-belt-startup.json`.
5. Optionally auto-commits only the sample artifacts.

## Deployment
The browser assets and API share one Node process. Static-only hosting does not provide full live catalog/search functionality.

After committing a clean checkout, publish explicitly through your existing SSH connection:

```sh
python deploy/publish.py --host YOUR_SSH_ALIAS
```

On Windows, the wrapper finds an available Python 3 runtime:

```powershell
.\deploy.ps1 -HostAlias YOUR_SSH_ALIAS
```

This tests the commit, sends allowlisted source only, verifies the transfer and invokes a separately installed trusted server controller. Failed readiness restores the previous version. No Git key or automatic deployment poller is installed on the VPS. See [bootstrap, DNS, limits and recovery details](docs/DEPLOYMENT.md).

## No-Secrets Policy
1. No API key is required.
2. No secrets are embedded in the client or server.
3. `.env*` remains ignored. Server configuration and real contact details stay in `/etc/asteroid-explorer/environment`, outside Git and the image.
4. Deployment archives contain allowlisted application files only; operational scripts and private files are excluded.

## Testing
Application tests cover frontend math, backend request boundaries, bounded caching/upstream work and readiness. Deployment tests exercise archive validation, source selection and rollback without contacting Docker, SSH or JPL:

```sh
npm test
python -m unittest discover -s deploy -p 'test_*.py' -v
```

## Author
Daniel Häggström Pérez-Flecha
