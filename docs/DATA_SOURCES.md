# Official Data Sources

## Primary Source
1. NASA JPL Small-Body Database Query API (SBDB Query API)
- Endpoint: `https://ssd-api.jpl.nasa.gov/sbdb_query.api`
- Usage in this project:
  - `sb-kind=a` (asteroids)
  - `sb-class=MBA` (main-belt asteroids)
  - field selection for orbital + physical parameters
  - pagination with `limit` and `limit-from`

## Retrieved Fields
1. Identity: `spkid`, `full_name`, `pdes`, `class`
2. Orbital: `a`, `e`, `i`, `om`, `w`, `ma`, `epoch`
3. Physical: `diameter`, `albedo`, `H`

## Data Handling Notes
1. Numeric parsing is strict; invalid values become `null`.
2. Dashboard analytics operate on currently loaded records.
3. Missing physical values are expected and explicitly visualized.

## Delivery Strategy
1. Browser requests same-origin endpoint `/api/main-belt`.
2. Node server proxies and normalizes JPL data to avoid client CORS/network failures.
3. If local snapshot files are available (`data/catalog/manifest.json`), `/api/main-belt` samples from local chunks first.
4. If no local catalog is present, a bundled startup sample (`data/main-belt-startup.json`) can be served immediately while live data warms in the background.
5. `/api/search?q=...` searches local index first; only if local misses does it query live SBDB APIs.
6. Background refresh periodically pulls live API windows and overlays fresher records in-memory.
7. If JPL is unavailable and no local snapshot is available, fallback snapshot (`data/main-belt-fallback.json`) keeps UI functional.
8. Client-side direct calls to JPL are intentionally disabled.
