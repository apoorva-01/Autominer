# Analysis Runner README

## Architecture Overview
- Node.js microservice (Express)
- Handles AI-powered analysis of Slack conversations
- Uses OpenAI and Google Gemini APIs
- Caches results for performance
- Exposes endpoints for triggering and retrieving analysis
- Main files: `analysis-runner.js`, `analysis-core.js`

## Key Files
- `analysis-runner.js`: Express server, rate limiting, health check, analysis endpoints
- `analysis-core.js`: Core logic for fetching conversations, running AI models, storing results

## Setup
1. Copy env vars (OpenAI, Gemini, DB, etc.)
2. Install dependencies: `npm install`
3. Start: `node analysis-runner.js`
4. Health check: `GET /health` on configured port

## Responsibilities
- Receives analysis requests from backend
- Fetches and filters Slack conversations from DB
- Runs AI models (OpenAI/Gemini) to extract automation opportunities
- Stores results in DB
- Caches results for repeated queries 

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