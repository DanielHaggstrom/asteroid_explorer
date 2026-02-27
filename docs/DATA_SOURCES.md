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
1. Identity: `spkid`, `full_name`, `class`
2. Orbital: `a`, `e`, `i`, `om`, `w`, `ma`, `epoch`
3. Physical: `diameter`, `albedo`, `H`

## Data Handling Notes
1. Numeric parsing is strict; invalid values become `null`.
2. Dashboard analytics operate on currently loaded records.
3. Missing physical values are expected and explicitly visualized.

## Delivery Strategy
1. Browser requests same-origin endpoint `/api/main-belt`.
2. Node server proxies and normalizes JPL data to avoid client CORS/network failures.
3. If JPL is unavailable, a local fallback snapshot (`data/main-belt-fallback.json`) is served so the UI remains functional.
