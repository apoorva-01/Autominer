# Job Runner README

## Architecture Overview
- Node.js microservice for background jobs
- Handles scheduled Slack message fetching and history exports
- Integrates with Google Docs for exports
- Uses `node-cron` for scheduling
- Main files: `job-runner.js`, `jobs/daily-fetch.js`, `jobs/history-export-processor.js`
- Health check endpoint for monitoring

## Key Files
- `job-runner.js`: Starts job runner, health check server, initializes jobs
- `jobs/daily-fetch.js`: Fetches new Slack messages daily, saves to DB, exports to Google Docs
- `jobs/history-export-processor.js`: Handles on-demand full history exports
- `scripts/setup.sh`: Setup script for local/dev environments
- `README.md`: Detailed job runner documentation

## Setup
1. Copy `environment.example` to `.env` and fill in secrets
2. Install dependencies: `npm install`
3. Set up DB: `npx prisma generate && npx prisma db push`
4. Start: `npm run dev` (or use Docker)
5. Health check: `GET /health` on port 3002

## Responsibilities
- Scheduled daily Slack message fetching
- On-demand history export jobs
- Google Docs export and folder management
- Handles Slack API rate limits and retries
- Writes all data to shared database 

---

## Port Structure: Local Development vs. Production Deployment

### Local Development

| Component         | Port   | Publicly Accessible? | Description                                 |
|-------------------|--------|---------------------|---------------------------------------------|
| Frontend (Vite)   | 3000   | Yes                 | React app dev server                        |
| Backend API       | 3001   | Yes                 | Express/Node API server                     |
| Job Runner        | 3002   | No                  | Background jobs, not a web UI               |
| Analysis Service  | 3003   | No                  | Data/ML analysis, not a web UI              |

- Access frontend at: http://localhost:3000/
- Access backend API at: http://localhost:3001/
- Job runner and analysis are internal (no UI)

### Production Deployment

| Component         | Port/URL                  | Publicly Accessible? | Nginx Role/Notes                          |
|-------------------|--------------------------|---------------------|-------------------------------------------|
| Frontend          | 443 (https://...)         | Yes                 | Served as static files by Nginx           |
| Backend API       | 3001 (proxied to /api)    | Yes                 | Nginx proxies /api to backend             |
| Job Runner        | 3002                      | No                  | Internal only                             |
| Analysis Service  | 3003                      | No                  | Internal only                             |

- Frontend is built and served from `/var/www/autominer/frontend/dist` (no Node process on 3000)
- Backend API is proxied by Nginx at `/api`
- Job runner and analysis are not exposed publicly

--- 