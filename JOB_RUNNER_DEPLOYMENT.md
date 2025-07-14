# Job Runner Deployment Guide

This guide explains how to deploy the job runner service on a separate backend from your main API server.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Server    │    │   Job Runner    │
│   (Port 3000)   │◄──►│   (Port 3001)   │    │   (Port 3002)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                └───────────┬───────────┘
                                            │
                                    ┌─────────────────┐
                                    │   PostgreSQL    │
                                    │   Database      │
                                    └─────────────────┘
```

## Benefits of Separate Job Runner

* **Scalability**: Scale jobs independently from API
* **Reliability**: Job failures don't affect API
* **Resource isolation**: Different resource requirements
* **Independent deployment**: Update jobs without affecting API
* **Better monitoring**: Dedicated monitoring for job performance

## Deployment Options

### Option 1: Docker Compose (Recommended for Development)

1. **Update your main docker-compose.yml** (already done):
```yaml
services:
  api-server:
    # ... existing config ...
  
  job-runner:
    build:
      context: ./backend/job-runner
      dockerfile: Dockerfile
    ports:
      - "3002:3002"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      # ... other env vars ...
```

2. **Start all services**:
```bash
docker-compose up -d
```

### Option 2: Separate Server Deployment

#### Step 1: Prepare the Job Runner Server

1. **Create a new server** (VPS, EC2, etc.)

2. **Install dependencies**:
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL client
sudo apt-get install -y postgresql-client

# Install Docker (optional)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

#### Step 2: Deploy Job Runner

1. **Clone your repository**:
```bash
git clone <your-repo-url>
cd <your-repo>/backend/job-runner
```

2. **Set up environment**:
```bash
cp environment.example .env
# Edit .env with your configuration
```

3. **Install and setup**:
```bash
./scripts/setup.sh
```

4. **Start the service**:
```bash
npm start
```

#### Step 3: Production Process Management

**Using PM2**:
```bash
# Install PM2
npm install -g pm2

# Start job runner with PM2
pm2 start job-runner.js --name "job-runner"

# Save PM2 configuration
pm2 save
pm2 startup
```

**Using Systemd**:
```bash
# Create service file
sudo nano /etc/systemd/system/job-runner.service
```

```ini
[Unit]
Description=Slack Automation Job Runner
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/your/job-runner
ExecStart=/usr/bin/node job-runner.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable job-runner
sudo systemctl start job-runner
```

### Option 3: Cloud Platform Deployment

#### Heroku

1. **Create Heroku app**:
```bash
heroku create your-job-runner-app
```

2. **Set environment variables**:
```bash
heroku config:set DATABASE_URL="your-database-url"
heroku config:set NODE_ENV=production
# ... other env vars ...
```

3. **Deploy**:
```bash
git subtree push --prefix backend/job-runner heroku main
```

#### Railway

1. **Connect your repository**
2. **Set environment variables** in Railway dashboard
3. **Deploy automatically** on push

#### DigitalOcean App Platform

1. **Create new app** from your repository
2. **Set source directory** to `backend/job-runner`
3. **Configure environment variables**
4. **Deploy**

## Environment Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL="postgresql://username:password@host:port/database"

# Job Runner
JOB_RUNNER_PORT=3002
NODE_ENV=production

# Google APIs (if using Google Docs)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
```

### Database Connection

The job runner needs access to the same PostgreSQL database as your main API server. Ensure:

1. **Network access** between job runner and database
2. **Correct DATABASE_URL** with proper credentials
3. **Database migrations** are applied

## Monitoring and Health Checks

### Health Check Endpoint

The job runner exposes a health check at `/health`:

```bash
curl http://your-job-runner-host:3002/health
```

Expected response:
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

### Logging

Monitor logs for:
* Job execution status
* Database connection issues
* Slack API errors
* Google Docs integration problems

**PM2 logs**:
```bash
pm2 logs job-runner
```

**Systemd logs**:
```bash
sudo journalctl -u job-runner -f
```

### External Monitoring

Consider setting up:
* **Uptime monitoring** (UptimeRobot, Pingdom)
* **Error tracking** (Sentry)
* **Metrics collection** (Prometheus, DataDog)

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Test database connection
   npx prisma db push --accept-data-loss
   ```

2. **Job Runner Not Starting**
   ```bash
   # Check logs
   pm2 logs job-runner
   # or
   sudo journalctl -u job-runner -f
   ```

3. **Jobs Not Running**
   ```bash
   # Check if cron is working
   # Verify timezone settings
   # Check for errors in logs
   ```

4. **Port Already in Use**
   ```bash
   # Change JOB_RUNNER_PORT in .env
   # or kill process using the port
   lsof -ti:3002 | xargs kill -9
   ```

### Debug Mode

For troubleshooting, set `NODE_ENV=development`:
* Jobs run immediately on startup
* More verbose logging
* Development-specific features

## Scaling Considerations

### Horizontal Scaling

You can run multiple job runner instances:
* Each connects to the same database
* Each runs the same scheduled jobs
* Use load balancer for health checks

### Advanced Job Management

For production scaling, consider:
* **Redis** for job queuing
* **Bull** or similar job queue library
* **Distributed job scheduling**
* **Job deduplication**

## Security Considerations

1. **Network Security**:
   * Use VPN or private networks
   * Restrict database access
   * Use firewall rules

2. **Environment Variables**:
   * Never commit secrets to git
   * Use secure secret management
   * Rotate credentials regularly

3. **Container Security**:
   * Run as non-root user
   * Use minimal base images
   * Scan for vulnerabilities

## Migration Checklist

- [ ] Set up job runner server
- [ ] Configure environment variables
- [ ] Test database connection
- [ ] Deploy job runner service
- [ ] Verify health check endpoint
- [ ] Test job execution
- [ ] Set up monitoring
- [ ] Update main API server (remove job initialization)
- [ ] Test end-to-end functionality
- [ ] Set up backup and recovery procedures 