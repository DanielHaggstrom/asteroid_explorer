# Visualization Strategy

## Why These Visualizations
The asteroid belt is best understood through both population-level summaries and orbital geometry. This dashboard focuses on visualizations that are computationally simple in-browser, scientifically interpretable, and directly driven by API fields.

## Selected Visualizations
1. Size Category Distribution (Bar Chart)
- Goal: show how many objects are tiny versus large.
- Data: `diameter`.
- Categories: `<0.5`, `0.5-1`, `1-2`, `2-5`, `5-10`, `10-20`, `20-50`, `>=50 km`, `Unknown`.

2. Orbital Distribution (Scatter Plot)
- Goal: reveal clustering and spread of orbital shapes.
- Axes: semi-major axis (`a`) vs eccentricity (`e`).
- Color: inclination (`i`) as a heat cue.

3. Semi-major Axis Density (Histogram)
- Goal: emphasize where asteroid counts dip and cluster across the belt.
- Data: `a`.
- Overlay: main Kirkwood resonance guides (3:1, 5:2, 7:3, 2:1).

4. Angular Distribution (True Anomaly Histogram)
- Goal: inspect orbital-phase distribution in a single epoch snapshot.
- Data: true anomaly solved from `e` + `ma`.
- Includes uniform-reference line for comparison.

5. Top-Down Belt Navigator (2D Map)
- Goal: make orbital placement intuitive.
- Uses orbital elements (`a`, `e`, `om`, `w`, `ma`) to compute approximate heliocentric XY position at the provided epoch.
- Supports click selection for object inspection.

6. KPI Cards
- Goal: provide quick context before deep exploration.
- Metrics: total loaded objects, objects with diameter, mean diameter, mean eccentricity, dominant belt zone.

7. Searchable Object Table + Details Panel
- Goal: bridge charts to object-level interpretation.
- Table provides scannable rows; selection opens concise summary of orbital and physical values.

## Interaction Model
1. Filter first (text + belt zone).
2. Read updated KPIs and charts.
3. Pick object from map/table.
4. Inspect details panel.

## Known Scientific Caveats
1. Rendered positions are 2D approximations from orbital elements; this is not a high-fidelity ephemeris simulation.
2. Missing diameters and albedo values are common and surfaced as `Unknown`.
3. Loaded population is intentionally a high-volume subset for browser responsiveness (not the full catalog).
4. Angular (true-anomaly) unevenness can be muted in broad snapshots due phase mixing and survey-selection effects; Jovian influence is often clearer in semi-major-axis structure (Kirkwood gaps).
