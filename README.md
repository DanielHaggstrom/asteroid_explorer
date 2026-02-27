# Asteroid Belt Explorer

Browser-based dashboard for visual and intuitive exploration of main-belt asteroids using official NASA/JPL public API data.

## What This Builds
1. Population-level understanding:
- Size category counts.
- Orbital distribution (`a` vs `e`) with inclination color cue.
- Key summary metrics.

2. Spatial intuition:
- Top-down belt navigator using orbital elements for approximate object placement.

3. Object-level inspection:
- Search/filter + clickable table/map.
- Detail panel for selected asteroid.

## Chosen Visualization Objectives
The project starts with visualizations that provide high explanatory value for the belt while staying robust in-browser:
1. Size distribution bar chart.
2. Orbital scatter chart.
3. Belt map navigator.
4. KPI cards.
5. Searchable object list + details pane.

See:
- [Roadmap](docs/ROADMAP.md)
- [Visualization notes](docs/VISUALIZATIONS.md)

## Data Source
Primary source:
- NASA/JPL SBDB Query API: `https://ssd-api.jpl.nasa.gov/sbdb_query.api`

Runtime access model:
1. Browser calls same-origin `/api/main-belt` (Node proxy).
2. Proxy fetches JPL API and caches short-term in memory.
3. If upstream is unavailable, app serves local fallback snapshot (`data/main-belt-fallback.json`).

Reference docs:
- https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html
- [Data source notes](docs/DATA_SOURCES.md)

## Project Structure
```
asteroid_explorer/
  docs/
  src/
    css/
    js/
  tests/
  index.html
  SECURITY.md
```

## Local Run
Requirements:
1. Node.js 18+

Commands:
```bash
npm test
npm run dev
```

Then open:
- `http://localhost:4173`

## Production/Publishing
Recommended deployment is Node hosting (Render, Railway, Fly.io, etc.) so the same-origin proxy avoids browser CORS/network issues against third-party APIs.

Static-only hosting is not supported for live data in this version because the client is intentionally proxy-only.

Recommended production settings:
1. HTTPS enforced.
2. Security headers enabled (see [SECURITY.md](SECURITY.md)).
3. Optional scheduled data snapshot strategy if you want deterministic datasets rather than live API calls.

## No-Secrets Policy
1. No API key is required.
2. `.env*` is ignored.
3. Do not embed any private tokens in frontend code.

## Testing
Current tests cover core data-math helpers:
1. Diameter bucketing.
2. Belt-zone classification.
3. Kepler solver and orbital position output sanity.
