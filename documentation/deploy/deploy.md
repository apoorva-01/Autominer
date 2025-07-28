ssh root@143.110.239.107
ecomExperts@1214ecom



# Fast DigitalOcean Deployment (No Docker/Git)

## Quick Setup - Deploy in 30 minutes

### 1. Create DigitalOcean Droplet

1. **DigitalOcean Dashboard** → **Create** → **Droplet**
2. **Image**: Ubuntu 22.04 LTS
3. **Size**: $24/month (4 GB RAM, 2 vCPU, 80 GB SSD)
4. **Authentication**: SSH keys
5. **Hostname**: `autominer-production`
6. Click **Create Droplet**

### 2. Create Managed PostgreSQL Database

1. **DigitalOcean Dashboard** → **Create** → **Database**
2. **Engine**: PostgreSQL 15
3. **Size**: $30/month (2 GB RAM, 1 vCPU, 20 GB storage)
4. **Name**: `autominer-db`
5. Click **Create Database**

### 3. Server Setup (5 minutes)

```bash
# SSH into your droplet
ssh root@your-droplet-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install certbot for SSL
apt install -y certbot python3-certbot-nginx

# Create application user
adduser --system --group --home /var/www/autominer autominer
usermod -aG sudo autominer
su - autominer
```

### 4. Upload Your Code (5 minutes)

**Option A: Using SCP (if you have code locally)**
```bash
# From your local machine
scp -r /path/to/your/Lifechanging/* root@your-droplet-ip:/var/www/autominer/
```

**Option B: Using File Manager**
1. Use DigitalOcean's file manager or SFTP client
2. Upload your entire project to `/var/www/autominer/`

**Option C: Direct Download**
```bash
# If your code is in a public repo
cd /var/www/autominer
wget https://github.com/yourusername/Lifechanging/archive/main.zip
apt install unzip
unzip main.zip
mv Lifechanging-main/* .
rm -rf Lifechanging-main main.zip
```

### 5. Set Permissions
```bash
sudo chown -R autominer:autominer /var/www/autominer
sudo chmod -R 755 /var/www/autominer
```

### 6. Install Dependencies (5 minutes)

```bash
cd /var/www/autominer

# Backend dependencies
cd backend
npm install --production

# Frontend dependencies and build
cd ../frontend
npm install
npm run build

# Analysis runner dependencies
cd ../backend/analysis-runner
npm install

# Job runner dependencies
cd ../job-runner
npm install
```

### 7. Configure Environment (5 minutes)

```bash
cd /var/www/autominer/backend
nano .env
```

Add your environment variables:
```env
# Database (from DigitalOcean Database)
DATABASE_URL="postgresql://doadmin:your-password@your-db-host:25060/defaultdb?sslmode=require"

# Server
NODE_ENV=production
PORT=3001

# JWT Secret (generate a secure one)
JWT_SECRET="your-super-secure-jwt-secret-here"

# OpenAI/Gemini
OPENAI_API_KEY="sk-your-openai-key"
GEMINI_API_KEY="your-gemini-key"

# Slack OAuth
SLACK_CLIENT_ID="your-slack-client-id"
SLACK_CLIENT_SECRET="your-slack-client-secret"
SLACK_REDIRECT_URI="https://yourdomain.com/slack/callback"

# Analysis Runner
ANALYSIS_RUNNER_PORT=3003

# Job Runner
JOB_RUNNER_PORT=3002
```

### 8. Database Migration (2 minutes)

```bash
cd /var/www/autominer/backend
npx prisma migrate deploy
npx prisma generate
```

### 9. Create PM2 Configuration (3 minutes)

```bash
cd /var/www/autominer
nano ecosystem.config.js
```

Add this configuration:
```javascript
module.exports = {
  apps: [
    {
      name: 'backend-api',
      script: './backend/server.js',
      cwd: '/var/www/autominer',
      env_file: './backend/.env',
      instances: 1,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      log_file: './logs/backend.log',
      time: true
    },
    {
      name: 'job-runner',
      script: './backend/job-runner/job-runner.js',
      cwd: '/var/www/autominer',
      env_file: './backend/.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      log_file: './logs/job-runner.log',
      time: true
    },
    {
      name: 'analysis-runner',
      script: './backend/analysis-runner/analysis-runner.js',
      cwd: '/var/www/autominer',
      env_file: './backend/.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      log_file: './logs/analysis-runner.log',
      time: true
    }
  ]
};
```

### 10. Start Services (2 minutes)

```bash
# Create logs directory
mkdir -p /var/www/autominer/logs

# Start all services
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions provided
```

### 11. Configure Nginx (3 minutes)

```bash
sudo nano /etc/nginx/sites-available/autominer
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend
    location / {
        root /var/www/autominer/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Job Runner health
    location /job-runner/health {
        proxy_pass http://localhost:3002/health;
        proxy_set_header Host $host;
    }

    # Analysis Runner
    location /analysis-runner {
        proxy_pass http://localhost:3003;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/autominer /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 12. SSL Certificate (2 minutes)

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### 13. Test Everything (3 minutes)

```bash
# Check if services are running
pm2 status

# Check logs
pm2 logs

# Test endpoints
curl http://localhost:3001/api/health
curl http://localhost:3002/health
curl http://localhost:3003/health

# Test frontend
curl http://localhost
```

### 14. Quick Backup Script

```bash
sudo nano /usr/local/bin/backup-autominer.sh
```

Add:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/autominer"
mkdir -p $BACKUP_DIR

# Backup database (replace with your actual DB details)
PGPASSWORD="your-db-password" pg_dump -h your-db-host -p 25060 -U doadmin -d defaultdb > $BACKUP_DIR/db_backup_$DATE.sql
gzip $BACKUP_DIR/db_backup_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
echo "Backup completed: $DATE"
```

```bash
sudo chmod +x /usr/local/bin/backup-autominer.sh
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-autominer.sh
```

## Quick Commands for Management

```bash
# Check status
pm2 status

# View logs
pm2 logs

# Restart all services
pm2 restart all

# Stop all services
pm2 stop all

# Start all services
pm2 start all

# Monitor resources
pm2 monit
```

## Troubleshooting

```bash
# If services won't start, check logs
pm2 logs

# If database connection fails
cd /var/www/autominer/backend
node -e "console.log('Testing DB...'); require('@prisma/client').PrismaClient.$connect().then(() => console.log('DB OK')).catch(console.error)"

# If Nginx fails
sudo nginx -t
sudo systemctl status nginx

# Check disk space
df -h

# Check memory usage
free -h
```

## Your App is Now Live!

- **Frontend**: https://yourdomain.com
- **Backend API**: https://yourdomain.com/api
- **Job Runner**: https://yourdomain.com/job-runner/health
- **Analysis Runner**: https://yourdomain.com/analysis-runner/health

**Total deployment time: ~30 minutes**