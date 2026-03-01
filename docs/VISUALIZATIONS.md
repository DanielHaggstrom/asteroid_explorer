# Visualization Strategy

## Why These Visualizations
The asteroid belt is easier to understand when broad population structure and individual objects are visible together. This dashboard focuses on charts that are computationally light in the browser, scientifically interpretable, and compatible with a prepared startup sample.

## Selected Visualizations
1. Size Category Distribution (Bar Chart)
- Goal: show how many loaded objects are tiny versus large.
- Data: `diameter`.
- Categories: `<0.5`, `0.5-1`, `1-2`, `2-5`, `5-10`, `10-20`, `20-50`, `>=50 km`.
- `Unknown` is excluded from the plotted bars.

2. Orbital Distribution (Scatter Plot)
- Goal: reveal clustering and spread of orbital shapes.
- Axes: semi-major axis (`a`) vs eccentricity (`e`).
- Color cue: inclination (`i`).

3. Semi-major Axis Density (Histogram)
- Goal: emphasize where asteroid counts dip and cluster across the belt.
- Data: `a`.
- Overlay: Kirkwood resonance guides (3:1, 5:2, 7:3, 2:1).

4. Angular Distribution (True Anomaly Histogram)
- Goal: inspect orbital-phase distribution within the currently loaded sample.
- Data: true anomaly solved from `e` and `ma`.
- Includes a uniform-reference line for visual comparison.

5. Top-Down Belt Navigator (2D Map)
- Goal: make the belt spatially intuitive.
- Uses orbital elements (`a`, `e`, `om`, `w`, `ma`) to compute approximate heliocentric XY positions.
- Supports click selection.
- If a searched or table-selected object was not in the prepared sample, it is pinned into the live sample so it appears here.

6. KPI Cards
- Goal: provide sample-level context quickly.
- Metrics: loaded sample size, diameter coverage, mean diameter, mean eccentricity, dominant belt zone.

7. Full-Catalog Browser + Detail Panel
- Goal: bridge sample-based visuals with the full catalog.
- Table uses server-side pagination, sorting, and filters against the live JPL catalog.
- Selection opens the detailed object summary and pins the object into the live sample.

## Interaction Model
1. Load the prepared startup sample.
2. Use the zone filter to focus the visuals.
3. Search a specific body or browse the full catalog table.
4. Select an object from the map or table.
5. Inspect the detail panel and see the selected body reflected in the map/charts.

## Known Scientific Caveats
1. Rendered positions are 2D approximations from orbital elements; this is not a high-fidelity ephemeris simulation.
2. Missing diameter and albedo values are common and surfaced as `Unknown`.
3. The charts describe the loaded sample rather than the entire catalog.
4. Angular unevenness can be muted in broad samples because of phase mixing and survey-selection effects; Jovian influence is often clearer in the semi-major-axis structure through Kirkwood gaps.
