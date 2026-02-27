# Visualization Strategy

## Why These Visualizations
The asteroid belt is best understood through both population-level summaries and orbital geometry. This dashboard focuses on visualizations that are computationally simple in-browser, scientifically interpretable, and directly driven by API fields.

## Selected Visualizations
1. Size Category Distribution (Bar Chart)
- Goal: show how many objects are tiny versus large.
- Data: `diameter`.
- Categories: `<1 km`, `1-5 km`, `5-20 km`, `>=20 km`, `Unknown`.

2. Orbital Distribution (Scatter Plot)
- Goal: reveal clustering and spread of orbital shapes.
- Axes: semi-major axis (`a`) vs eccentricity (`e`).
- Color: inclination (`i`) as a heat cue.

3. Top-Down Belt Navigator (2D Map)
- Goal: make orbital placement intuitive.
- Uses orbital elements (`a`, `e`, `om`, `w`, `ma`) to compute approximate heliocentric XY position at the provided epoch.
- Supports click selection for object inspection.

4. KPI Cards
- Goal: provide quick context before deep exploration.
- Metrics: total loaded objects, objects with diameter, mean diameter, mean eccentricity, dominant belt zone.

5. Searchable Object Table + Details Panel
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
3. API pagination limits means loaded population can be a subset unless expanded in config or precomputed offline.
