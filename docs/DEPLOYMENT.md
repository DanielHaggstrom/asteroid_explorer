# Deployment Notes

## Live Service
1. Public app: `https://asteroid-explorer.onrender.com/`
2. Health endpoint: `https://asteroid-explorer.onrender.com/healthz`

## Hosting Model
1. The app is deployed as a Render Node web service.
2. Static frontend assets and API endpoints are served by the same Node process.
3. This avoids browser-side CORS issues against the NASA/JPL APIs.

## Render Configuration
1. Runtime: `Node`
2. Build command: `npm install`
3. Start command: `npm run serve`
4. Branch: `main`

## Free-Tier Caveats
1. Free instances can cold-start after inactivity, so the first request may be slower.
2. Ephemeral service filesystems are not a durable place for generated catalog snapshots.
3. If you want the full local catalog in production, either:
- generate it before deployment and ship it with the release artifacts, or
- deploy on infrastructure with persistent storage.

## Operational Notes
1. The current live deployment works without secrets.
2. The service can run directly against the live JPL APIs and local fallback snapshot.
3. The optional `catalog:build` workflow is best suited for local preparation or persistent-hosting setups.

## Ownership
Maintained by Daniel Häggström Pérez-Flecha.
