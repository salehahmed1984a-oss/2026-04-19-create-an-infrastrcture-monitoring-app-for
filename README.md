# HPE Mist Infrastructure Monitor

A lightweight infrastructure monitoring app for HPE Mist that uses the Mist API through a local Node.js proxy.

## What it does

- Reads your Mist sites from `GET /api/v1/orgs/:org_id/sites`
- Pulls device statistics from `GET /api/v1/sites/:site_id/stats/devices`
- Pulls open alarm counts from `GET /api/v1/sites/:site_id/alarms/count`
- Pulls open alarm details from `GET /api/v1/sites/:site_id/alarms/search`
- Shows a dashboard with:
  - organization-wide totals
  - per-site health score
  - online versus offline device counts
  - client totals
  - warning and critical alarm pressure
  - average CPU and memory pressure
  - auto-refresh controls
  - persisted history with trend charts
  - device and active alarm details for a selected site
  - top client-load devices for faster troubleshooting

## Why this shape

Mist tokens should not live in frontend JavaScript. This app keeps the token on the local server and exposes only dashboard-friendly API routes to the browser.

## Mist API notes

This project is based on Mist documentation for:

- API introduction and base API structure: [Mist API Introduction](https://www.mist.com/documentation/mist-api-introduction/)
- Token creation and token-based auth direction: [Create API Tokens](https://www.juniper.net/documentation/us/en/software/mist/automation-integration/topics/task/create-token-for-rest-api.html)
- Device stats endpoint examples: [Get AP Stats](https://api-class.mist.com/rest/read/monitoring/get_devices/)
- Alarm webhook and alarm model background: [Monitoring Mist with Webhooks](https://www.mist.com/documentation/monitoring-mist-with-webhooks/)

The app assumes:

- `Authorization: Token <token>` is accepted for Mist API requests
- production API base URL is `https://api.mist.com`
- `MIST_ORG_ID` is the Mist organization UUID you want to monitor

If your tenant uses another cloud endpoint, set `MIST_API_BASE_URL` accordingly.

## Run it

Create a real `.env` file in the project root. The server will load `.env` automatically, and only falls back to `.env.example` if `.env` is missing.

This workspace already includes a bundled Node runtime.

### Easiest option

Double-click [start-monitor.cmd](C:/Users/AAIConsultants/Documents/Codex/2026-04-19-create-an-infrastrcture-monitoring-app-for/start-monitor.cmd)

### PowerShell option

From this project directory:

```powershell
& "C:\Users\AAIConsultants\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Then open [http://localhost:3000](http://localhost:3000).

## Configuration

Environment variables:

- `MIST_API_TOKEN`: required
- `MIST_ORG_ID`: optional but recommended
- `MIST_API_BASE_URL`: optional, defaults to `https://api.mist.com`
- `PORT`: optional, defaults to `3000`
- `MAX_HISTORY_SNAPSHOTS`: optional, defaults to `288`

For security, keep live credentials in `.env` and leave `.env.example` as a template.

## History and Trends

Every successful dashboard refresh writes a lightweight snapshot to [data/history.json](C:/Users/AAIConsultants/Documents/Codex/2026-04-19-create-an-infrastrcture-monitoring-app-for/data/history.json). This powers:

- organization health trend chart
- offline device trend chart
- per-site health trend chart

If you refresh every minute, `288` snapshots is about 4.8 hours of retained history.

## Project structure

- `server.js`: static server plus Mist API proxy
- `public/index.html`: dashboard shell
- `public/styles.css`: responsive dashboard styling
- `public/app.js`: dashboard behavior
- `start-monitor.ps1`: friendly PowerShell launcher
- `start-monitor.cmd`: double-click launcher for Windows users
- `data/history.json`: generated monitoring history store

## Next steps you may want

- add webhook ingestion for near-real-time alarms
- persist snapshots to SQLite or Postgres for trends
- add auth in front of the dashboard for team access
- export daily health summaries
- add site filtering by tag or site group
