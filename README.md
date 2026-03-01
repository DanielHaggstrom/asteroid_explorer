# Asteroid Belt Explorer

Browser-based dashboard for visual and intuitive exploration of main-belt asteroids using official NASA/JPL public API data.

## Live App
- Production deployment: https://asteroid-explorer.onrender.com/
- Health check: https://asteroid-explorer.onrender.com/healthz

Free Render instances can cold-start after inactivity, so the first request may take a short moment.

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
This project intentionally uses a hybrid model that fits Render's free-tier constraints.

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
1. Node.js 18+

Commands:
```bash
npm install
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
This repo is Render-first, but not Render-only.

1. Reference deployment target: Render Node web service.
2. Works on any Node host that can make outbound HTTPS requests to the JPL APIs.
3. Static-only hosting is not enough because the app depends on same-origin API endpoints served by `server.mjs`.

Current production deployment:
- https://asteroid-explorer.onrender.com/

Recommended Render settings:
1. Runtime: `Node`
2. Build command: `npm install`
3. Start command: `npm run serve`

## No-Secrets Policy
1. No API key is required.
2. No secrets are embedded in the client or server.
3. `.env*` remains ignored for future extensions, but this project does not currently need any environment secrets.

## Testing
Current tests cover the core math and categorization helpers used by the frontend:
1. Diameter bucketing.
2. Belt-zone classification.
3. Kepler solver and orbital-position sanity.

## Author
Daniel Häggström Pérez-Flecha
