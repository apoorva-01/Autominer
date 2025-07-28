# Frontend README

## Architecture Overview
- React (with React Router, React Query, MUI, recharts, etc.)
- Context-based state management (auth, departments, workspace)
- Admin and user dashboards, Slack connect, org chart, analysis, automations, reports
- Entry: `frontend/src/main.jsx` and `frontend/src/App.jsx`
- Components organized by role (`admin/`, `user/`, `common/`)
- API calls proxied to backend via Vite config

## Key Files
- `src/App.jsx`: Route definitions, protected routes, lazy loading
- `src/contexts/`: Auth, Departments, Workspace providers
- `src/components/`: UI components
- `vite.config.js`: Dev server and proxy config

## Setup
1. Install dependencies: `npm install`
2. Start dev server: `npm run dev`
3. Build: `npm run build`
4. Ensure backend is running and API proxy is set up

## Responsibilities
- User and admin dashboards
- Slack workspace connection UI
- Org chart and department management
- Analysis and automation UI
- Reports and settings 

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