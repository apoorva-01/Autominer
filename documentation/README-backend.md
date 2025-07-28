# Backend README

## Architecture Overview
- Node.js + Express REST API
- Uses Prisma ORM with PostgreSQL
- Handles authentication, Slack OAuth, user/department management, and exposes endpoints for analysis, reports, and Slack integration
- Environment config via `.env`
- Main entry: `backend/server.js`
- Routes: `backend/routes/`
- DB schema: `backend/prisma/schema.prisma`
- Analysis and job processing are offloaded to separate services

## Key Files
- `server.js`: Express app, middleware, starts server
- `routes/`: Modular route handlers (auth, admin, analysis, slack, reports)
- `prisma/`: DB schema, migrations, and utility scripts
- `config/environment.example`: Example env vars

## Setup
1. Copy `config/environment.example` to `.env` and fill in secrets
2. Install dependencies: `npm install`
3. Set up DB: `npx prisma generate && npx prisma db push`
4. Start: `npm run dev`

## Environment Variables
See `backend/config/environment.example` for all required and optional variables.

## Responsibilities
- User authentication and authorization
- Slack OAuth and workspace connection
- Department, role, and org chart management
- Exposes REST endpoints for frontend
- Delegates analysis and job processing to microservices 

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