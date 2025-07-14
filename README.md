# Slack Automation Discovery System

🚀 **Automatically discover repetitive workflows in your company by analyzing Slack conversations and suggest high-impact automations.**

## Overview

This system taps into your company's internal Slack communications to identify repetitive manual tasks that could be automated. It uses AI to analyze conversation patterns and provides actionable automation recommendations with ROI estimates.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   Database      │
│   (React)       │◄──►│   (Node.js)     │◄──►│   (PostgreSQL)  │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       
         │                       │                       
         ▼                       ▼                       
┌─────────────────┐    ┌─────────────────┐              
│   Slack OAuth   │    │   Pipedream     │              
│   Integration   │    │   Workflows     │              
│                 │    │                 │              
└─────────────────┘    └─────────────────┘              
                                │                       
                                ▼                       
                   ┌─────────────────┐                  
                   │   OpenAI        │                  
                   │   Analysis      │                  
                   │                 │                  
                   └─────────────────┘                  
```

## Features

- **Slack Integration**: Seamless OAuth connection to analyze DMs, channels, and threads
- **AI-Powered Analysis**: Uses OpenAI to identify automation opportunities
- **ROI Estimation**: Ranks tasks by frequency, difficulty, and business impact
- **Automated Reporting**: Weekly/monthly automation discovery reports
- **User-Friendly Dashboard**: Simple interface for non-technical users

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- Slack workspace with admin permissions
- Pipedream account
- OpenAI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd slack-automation-discovery
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   ```bash
   cd backend
   cp config/environment.example .env
   # Edit .env with your database credentials
   npx prisma migrate dev
   ```

4. **Configure environment variables**
   
   Edit `backend/.env` with your credentials:
   ```
   DATABASE_URL="postgresql://username:password@localhost:5432/slack_automation_discovery"
   SLACK_CLIENT_ID=your-slack-client-id
   SLACK_CLIENT_SECRET=your-slack-client-secret
   PIPEDREAM_API_KEY=your-pipedream-api-key
   OPENAI_API_KEY=your-openai-api-key
   ```

5. **Start the development servers**
   ```bash
   npm run dev
   ```

   This starts both frontend (http://localhost:3000) and backend (http://localhost:3001).

## Usage

### 1. Connect Slack Account
- Visit the frontend application
- Click "Connect Slack Account"
- Authorize the OAuth permissions
- Select channels/DMs to monitor

### 2. Data Collection
- The system automatically scrapes conversations via Pipedream workflows
- Data is stored securely and analyzed for patterns

### 3. AI Analysis
- Weekly analysis runs identify repetitive tasks
- Tasks are ranked by automation potential
- Suggestions include difficulty estimates and tool recommendations

### 4. Review Reports
- Access automation reports in the dashboard
- Review suggested automations with ROI estimates
- Track implementation progress

## Example Discovered Automations

| Task | Frequency | Difficulty | ROI | Suggested Tools |
|------|-----------|------------|-----|-----------------|
| Create Notion board for new clients | 4x/week | Low | High | Zapier, Pipedream |
| Weekly PSI reports | 1x/week | Low | Medium | Google Lighthouse + Pipedream |
| Copy support transcripts | 3x/day | Medium | High | Zapier, Notion API |
| Assign leads after demos | 2x/day | Medium | High | Make, HubSpot API |

## API Endpoints

### Authentication
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration

### Slack Integration
- `GET /api/slack/auth` - Initiate Slack OAuth
- `POST /api/slack/callback` - Handle OAuth callback
- `GET /api/slack/connections` - List user's Slack connections

### Analysis
- `POST /api/analysis/run` - Trigger manual analysis
- `GET /api/analysis/results` - Get analysis results

### Reports
- `GET /api/reports` - List automation reports
- `GET /api/reports/:id` - Get specific report

## Technology Stack

**Frontend:**
- React 18 with Vite
- React Router for navigation
- React Query for state management
- Tailwind CSS for styling
- Lucide React for icons

**Backend:**
- Node.js with Express
- Prisma ORM with PostgreSQL
- JWT authentication
- OpenAI API integration
- Pipedream API integration

**Infrastructure:**
- Pipedream for Slack data collection
- PostgreSQL for data storage
- OpenAI for conversation analysis

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For questions or issues, please contact the development team or create an issue in the repository. 