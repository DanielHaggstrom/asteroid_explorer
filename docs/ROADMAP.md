# Asteroid Explorer Roadmap

## Product Objective
Build a browser-based asteroid-belt exploration dashboard that helps users understand population patterns, orbital structure, and individual-object properties using official, public scientific data.

## Current Status
Phase 1 is shipped and publicly deployed at `https://asteroid-explorer.onrender.com/`.

## Phase 1: Production MVP
1. Data foundation
- Integrate JPL SBDB Query API for main-belt asteroid data.
- Normalize and validate key fields (orbital and physical parameters).
- Add robust failure handling (timeouts, partial data, user-facing errors).

2. Core visualizations
- Population by size category (bar chart).
- Orbital distribution (semi-major axis vs eccentricity scatter).
- Top-down belt navigator (simplified 2D orbital position map).
- KPI cards for counts and aggregate metrics.

3. Object exploration
- Search + zone filtering.
- Click-to-select from map and table.
- Dedicated details panel for selected object.

4. Production readiness
- No secrets in code or config.
- Secure-by-default frontend (CSP, no unsafe HTML rendering).
- Clear documentation and operational guidance.
- Unit tests for orbital and categorization logic.

## Phase 2: Data Depth + Analytics
1. Add ingestion script to snapshot API data for static hosting.
2. Add additional orbital distributions (inclination, period, albedo when available).
3. Introduce uncertainty and missing-data indicators across charts.
4. Add data-refresh strategy and change-log notes in docs.

## Phase 3: Advanced Exploration
1. Epoch-time slider to animate orbital positions.
2. Family/group overlays (if official source coverage is adequate).
3. Comparative view for multiple selected asteroids.
4. Accessibility enhancements (keyboard map selection, high-contrast mode).

## Success Criteria
1. Dashboard loads and renders in modern desktop/mobile browsers.
2. User can discover macro trends and inspect individual objects in under 30 seconds.
3. Data source and caveats are transparent.
4. No secrets are required for local run or deployment.
