# Deployment Notes

## Live Service
1. Public app: `https://asteroid-explorer.onrender.com/`
2. Health endpoint: `https://asteroid-explorer.onrender.com/healthz`

## Hosting Model
1. The app is deployed as a Render Node web service.
2. Static frontend assets and API endpoints are served by the same Node process.
3. This avoids browser-side CORS issues against the NASA/JPL APIs.
4. Render is the reference deployment target, but any Node host with outbound HTTPS can run the app.

## Why The Current Architecture Fits Render
1. Free Render services have cold starts after inactivity.
2. Free Render services do not provide durable runtime filesystem updates.
3. The app therefore ships a prepared startup sample in git and uses live JPL APIs for the full catalog and search.
4. Runtime refresh is intentionally in-memory only.

## Render Configuration
1. Runtime: `Node`
2. Build command: `npm install`
3. Start command: `npm run serve`
4. Branch: `main`

## Operational Notes
1. No secrets are required.
2. The health check is `GET /healthz`.
3. First request after inactivity may be slower because of Render cold starts.
4. The first UI paint stays fast because `data/main-belt-startup.json` is served locally.

## Updating Data
1. Refresh the committed startup sample locally with `npm run sample:update`.
2. Commit and push the updated `data/main-belt-startup.json` file.
3. Render redeploys from `main` and starts serving the refreshed sample.

## Ownership
Maintained by Daniel Häggström Pérez-Flecha.
