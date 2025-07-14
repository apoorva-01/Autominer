# Job Runner Service

This is a separate service that handles all background jobs for the Slack Automation Discovery system. It runs independently from the main API server.

## Features

* Daily message fetching from Slack channels
* Google Docs integration for message exports
* Health check endpoint
* Graceful shutdown handling
* Docker support

## Architecture

The job runner is designed to be deployed as a separate service from the main API server. This provides several benefits:

* **Scalability**: Jobs can be scaled independently from the API
* **Reliability**: Job failures don't affect the main API
* **Resource isolation**: Jobs can use different resources than the API
* **Independent deployment**: Jobs can be updated without affecting the API

## Setup

### Local Development

1. Copy the environment file:
```bash
cp environment.example .env
```

2. Install dependencies:
```bash
npm install
```

3. Set up the database:
```bash
npx prisma generate
npx prisma db push
```

4. Start the job runner:
```bash
npm run dev
```

### Production Deployment

#### Using Docker

1. Build the image:
```bash
docker build -t slack-automation-job-runner .
```

2. Run the container:
```bash
docker run -d \
  --name job-runner \
  -p 3002:3002 \
  --env-file .env \
  slack-automation-job-runner
```

#### Using Docker Compose

The job runner is included in the main `docker-compose.yml` file. To run all services:

```bash
docker-compose up -d
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JOB_RUNNER_PORT` | Port for health check endpoint | No (default: 3002) |
| `NODE_ENV` | Environment (development/production) | No |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | No |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | No |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token | No |
| `SLACK_APP_IS_MARKETPLACE` | Set to 'true' if app is in Slack Marketplace | No (default: false) |

## Jobs

### Daily Fetch Job

* **Schedule**: Runs daily at 9:00 AM EST
* **Purpose**: Fetches new messages from active Slack channels
* **Features**:
  - Fetches messages since last fetch
  - Saves to database
  - Updates Google Docs (if configured)
  - Handles rate limiting
  - Token fallback (user token → bot token)

### History Export Job

* **Trigger**: On-demand via API
* **Purpose**: Exports complete message history from Slack channels
* **Features**:
  - Exports all messages from a channel
  - Saves to database and Google Docs
  - Handles rate limiting
  - Adaptive batch sizing

## Slack API Rate Limits (Important)

Starting May 29, 2025, Slack will implement significant rate limit changes for non-Marketplace applications:

* **conversations.history** and similar APIs will be limited to **1 request per minute**
* Maximum response size will be reduced to **15 objects** per request

Our application has been updated to handle these changes:

1. Set `SLACK_APP_IS_MARKETPLACE=true` if your app is published in the Slack Marketplace
2. For non-Marketplace apps, history exports will take significantly longer after May 2025
3. See `backend/SLACK_RATE_LIMITS_2025.md` for detailed information

## Health Check

The job runner exposes a health check endpoint at `/health`:

```bash
curl http://localhost:3002/health
```

Response:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "service": "Slack Automation Job Runner",
  "jobs": {
    "dailyFetch": "running"
  }
}
```

## Monitoring

### Logs

The job runner provides detailed logging for all operations:

* Job execution logs
* Database connection status
* Slack API responses
* Google Docs integration status
* Error handling

### Metrics

Consider adding monitoring with:
* Prometheus metrics
* Sentry for error tracking
* Custom health checks

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check `DATABASE_URL` environment variable
   - Ensure database is running and accessible

2. **Google APIs Not Working**
   - Verify Google OAuth credentials
   - Check refresh token validity

3. **Slack API Errors**
   - Verify Slack tokens are valid
   - Check rate limiting
   - Verify required scopes for each channel type:
     - Public channels: `channels:history`
     - Private channels: `groups:history`
     - DMs: `im:history`

### Debug Mode

Set `NODE_ENV=development` to enable:
* Immediate job execution on startup
* More verbose logging
* Development-specific features

## Scaling

The job runner can be scaled horizontally by running multiple instances. Each instance will:
* Connect to the same database
* Run the same scheduled jobs
* Use the same configuration

For more sophisticated job management, consider adding:
* Redis for job queuing
* Bull or similar job queue library
* Distributed job scheduling 