# Slack Automation Discovery System - Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL 12+
- Slack workspace with admin permissions
- OpenAI API key
- Pipedream account (for production Slack scraping)

## Quick Start

### 1. Environment Setup

```bash
# Install dependencies
npm install

# Backend setup
cd backend
cp config/environment.example .env
# Edit .env with your credentials

# Frontend setup  
cd ../frontend
npm install
```

### 2. Database Setup

```bash
cd backend

# Initialize Prisma
npx prisma generate
npx prisma migrate dev --name init

# Optional: Seed with sample data
npx prisma db seed
```

### 3. Environment Variables

Edit `backend/.env`:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/slack_automation_discovery"
JWT_SECRET=your-secret-key-here
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret
SLACK_REDIRECT_URI=http://localhost:3000/slack-connect
OPENAI_API_KEY=your-openai-api-key
PIPEDREAM_API_KEY=your-pipedream-api-key
FRONTEND_URL=http://localhost:3000
```

### 4. Slack App Configuration

1. Create a Slack app at https://api.slack.com/apps
2. Add OAuth scopes:
   - `channels:history`
   - `groups:history` 
   - `im:history`
   - `mpim:history`
   - `channels:read`
   - `groups:read`
   - `im:read`
   - `mpim:read`
   - `users:read`
   - `team:read`
3. Set redirect URL: `http://localhost:3000/slack-connect`

### 5. Start Development

```bash
# Start both frontend and backend
npm run dev
```

## Usage Flow

1. **Register/Login** at http://localhost:3000
2. **Connect Slack** workspace via OAuth
3. **Run Analysis** to discover automation opportunities
4. **Review Results** and update task statuses
5. **Generate Reports** for stakeholders

## Production Deployment

### Database
- Use managed PostgreSQL (AWS RDS, etc.)
- Update DATABASE_URL in production

### Frontend
```bash
cd frontend
npm run build
# Deploy dist/ folder to your hosting provider
```

### Backend
```bash
cd backend
npm start
# Deploy to your server/container platform
```

### Pipedream Workflows
- Import workflows from `workflows/` directory
- Configure with production environment variables
- Set up scheduling for automated data collection

## Key Features

- **OAuth Integration**: Seamless Slack workspace connection
- **AI Analysis**: OpenAI-powered automation discovery  
- **ROI Ranking**: Tasks prioritized by business impact
- **Report Export**: JSON/CSV formats for sharing
- **Task Management**: Status tracking and team collaboration

## Security Considerations

- All Slack tokens are encrypted at rest
- JWT tokens for secure authentication
- Rate limiting on API endpoints
- Input validation and sanitization
- CORS protection configured

## Support

For issues or questions:
1. Check the README.md for troubleshooting
2. Review API documentation in `/docs`
3. Examine log files for error details

## Architecture Benefits

This system provides:
- **Automated Discovery**: No manual workflow documentation needed
- **Data-Driven Decisions**: Real conversation analysis, not guesswork  
- **Scalable ROI**: Identifies high-impact, low-effort automations first
- **Team Adoption**: Simple UI for non-technical stakeholders 