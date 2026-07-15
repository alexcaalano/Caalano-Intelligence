# Data refresh — how the dashboard stays live

The dashboard reads a single snapshot file: `public/data/snapshot.json`.
The UI is static, so "live" = how often that snapshot is regenerated.

## What's in the snapshot
- **Paid performance** (Meta Ads + Google Ads) per client — pulled from **Reporting Ninja**.
- **Agency new-business pipeline** — pulled from **GoHighLevel / Caalano Systems**.
- Each metric carries current period + previous period so the UI can show MoM deltas.

The list of clients and their platform account IDs lives in `scripts/clients.js`
(the single source of truth). Add a row there to onboard a new client.

## Refresh options (pick one)

### A. Scheduled agent refresh (current model — no credentials)
The connectors (Reporting Ninja, GoHighLevel) are authorised to the Claude
workspace, not to a public server. A scheduled Claude session re-runs the pull
and rewrites `snapshot.json`, then commits. Netlify (connected to this repo)
auto-builds on the new commit. Cadence is whatever the schedule is set to
(e.g. every morning). This is how the first snapshot was produced.

Discovery chain used per client:
1. `list_integrations` → `list_connections` → `list_fields`
2. Meta: `query_data` on `facebook_ads` with
   `settings.attribution_window = ATTRIBUTION_MODEL_VIEW_CLICK###VIEW_ATTRIBUTION_WINDOW_1D###CLICK_ATTRIBUTION_WINDOW_7D`,
   fields `spend, impressions, clicks, actions:lead, cost_per_action_type:lead`.
3. Google: `query_data` on `google_ads`, `data_view: customer`,
   fields `metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_per_conversion`.
4. GHL: `get-pipelines` + `search-opportunity` (status=open) on the Lead Connector.

### B. Fully real-time backend (upgrade path — needs API keys)
Replace the static snapshot with Netlify serverless functions that call the
**Reporting Ninja REST API** and **GoHighLevel API** on each page load, using
API keys stored as Netlify environment variables. The `clients.js` registry and
the JSON shape stay identical, so the front-end doesn't change.

## Scope note — GHL / Caalano Systems
The Lead Connector is currently authorised for a **single** GHL sub-account
(Caalano Digital's own HQ pipeline). To pull **every client's** GHL pipeline
agency-wide, add an **agency-level (company) API token** as its own connector.
The registry already has a `ghlLocationId` field per client for this.
