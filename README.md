# Caalano · Reporting Dashboard

An interactive, multi-platform reporting dashboard for Caalano Digital that
brings **Meta Ads**, **Google Ads**, and **Caalano Systems (GoHighLevel)** into
one live view — an agency overview, per-client drill-down, and the agency's own
new-business pipeline.

Built with React + Vite + Recharts. Data is pulled from **Reporting Ninja**
(paid/analytics) and **GoHighLevel** (CRM/pipeline).

## Live views
- **Agency Overview** — blended KPIs (spend, results, cost/result, impressions,
  clicks, CTR) with month-over-month deltas, spend-by-client and channel-split
  charts, and a sortable client leaderboard.
- **Clients** — click any client to drill into their Meta and Google breakdown.
- **Agency Pipeline** — open opportunities, pipeline value, and stage breakdown
  from GoHighLevel.

The current snapshot covers **June 2026 vs May 2026**.

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs to dist/
```

## Deploy (Netlify, GitHub-connected)
This repo includes `netlify.toml` (`npm run build` → publish `dist/`, with an
SPA redirect). Connect this repository to the Netlify site
**caalano-reporting-dashboard** and every push (including scheduled data
refreshes) auto-builds and deploys.

## Data
- Client → account-ID mapping: [`scripts/clients.js`](scripts/clients.js)
- Snapshot consumed by the app: [`public/data/snapshot.json`](public/data/snapshot.json)
- How the snapshot is refreshed (and the real-time upgrade path):
  [`scripts/refresh.md`](scripts/refresh.md)

## Notes & next steps
- **GHL scope:** the connector is currently authorised for one sub-account
  (Caalano Digital HQ). An agency-level API token unlocks per-client CRM data
  agency-wide — the data layer already supports it.
- **More clients:** add rows to `scripts/clients.js`; the pipeline and UI scale
  automatically (the full book is 127 Meta / 31 Google / 20 GA4 accounts).
- **More history:** the snapshot can be extended with daily/multi-month series
  for trend lines.
