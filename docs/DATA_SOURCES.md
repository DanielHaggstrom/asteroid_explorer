# Official Data Sources

## Primary APIs
1. NASA/JPL Small-Body Database Query API (SBDB Query API)
- Endpoint: `https://ssd-api.jpl.nasa.gov/sbdb_query.api`
- Used for:
  - startup-sample refresh tooling
  - server-side catalog pagination
  - catalog sorting and filter constraints
  - fetching object records by designation or SPK-ID

2. NASA/JPL Small-Body Database Object API (SBDB Object API)
- Endpoint: `https://ssd-api.jpl.nasa.gov/sbdb.api`
- Used for:
  - resolving direct object searches such as `Ceres`, `Vesta`, or known designations

## Retrieved Fields
1. Identity: `spkid`, `full_name`, `pdes`, `class`
2. Orbital: `a`, `e`, `i`, `om`, `w`, `ma`, `epoch`
3. Physical: `diameter`, `albedo`, `H`

## Runtime Data Flow
1. Browser requests same-origin `GET /api/main-belt`.
2. The Node server serves the prepared startup sample from `data/main-belt-startup.json`.
3. Browser renders charts, KPIs, and the map from that startup sample.
4. Browser requests `GET /api/catalog` for the table.
5. The Node server proxies table pagination, sorting, and filters to the live JPL Query API.
6. Browser requests `GET /api/search?q=...` for object lookup.
7. The Node server uses the live JPL APIs to resolve search results.
8. When an object is selected, the client pins it into the live sample so it becomes visible in the charts and belt navigator.
9. Separately, the server refreshes part of the loaded sample in memory in the background.

## Prepared Sample Rules
1. The startup sample is intentionally smaller than the full catalog for browser responsiveness.
2. `config/startup-sample-core-bodies.json` defines bodies that must always survive sample regeneration.
3. `npm run sample:update` rebuilds the prepared sample from current JPL data.

## Data Handling Notes
1. Numeric parsing is strict; invalid values become `null`.
2. Missing physical values are expected and rendered explicitly as `Unknown`.
3. Aggregate charts describe the loaded sample, not the entire 1.3M+ object catalog.
4. Full-catalog browsing is available through the API-backed table rather than by loading the whole catalog into the browser.
