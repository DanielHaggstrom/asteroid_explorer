# Asteroid Explorer Roadmap

## Product Objective
Build a browser-based asteroid-belt exploration dashboard that helps users understand population patterns, orbital structure, and individual-object properties using official public scientific data.

## Current Status
Phase 1 is shipped and publicly deployed at `https://asteroid-explorer.onrender.com/`.

## Phase 1: Production MVP
1. Data foundation
- Integrate the JPL SBDB APIs.
- Commit a prepared startup sample for fast first paint.
- Add a maintained list of core bodies that must remain in every refreshed sample.
- Keep runtime refresh limited to an in-memory sample overlay.

2. Core visualizations
- Population by size category.
- Semi-major axis vs eccentricity scatter plot.
- Semi-major axis density histogram with Kirkwood resonance guides.
- True-anomaly distribution histogram.
- Belt navigator map.
- KPI cards for sample-level context.

3. Object exploration
- Live object search against JPL.
- API-backed full-catalog table with pagination, filters, and sorting.
- Click-to-select from the map and table.
- Selected-body detail panel.

4. Production readiness
- No secrets in code or config.
- Same-origin proxy server for JPL access.
- Security headers and strict CSP.
- Documentation for data refresh and deployment.
- Unit tests for shared math and categorization helpers.

## Phase 2: Analytical Depth
1. Add more distribution views for inclination, albedo, and orbital period.
2. Add clearer uncertainty and missing-data annotations in the UI.
3. Add optional compare mode for multiple selected bodies.
4. Add richer mobile interaction states for dense charts and the map.

## Phase 3: Exploration Enhancements
1. Add a time/epoch mode for alternative orbital snapshots.
2. Add official family or taxonomy overlays if the source coverage is robust enough.
3. Add bookmarking or shareable URLs for selected objects and filters.
4. Expand accessibility support for keyboard navigation and chart narration.

## Success Criteria
1. Dashboard loads reliably in modern desktop and mobile browsers.
2. Users can understand large-scale belt structure without waiting on the full catalog.
3. Users can still reach the full catalog through paginated API browsing.
4. Data sources, caveats, and deployment constraints are documented clearly.
