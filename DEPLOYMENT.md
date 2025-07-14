# AutoMiner - DigitalOcean Deployment Guide

## Overview

This guide covers deploying AutoMiner to DigitalOcean using:
- **Droplet**: Ubuntu 22.04 LTS server
- **Database**: DigitalOcean Managed PostgreSQL
- **Domain**: Custom domain with SSL
- **Process Manager**: PM2 for Node.js applications
- **Reverse Proxy**: Nginx for serving frontend and routing API

## Prerequisites

1. **DigitalOcean Account**: Sign up at https://digitalocean.com
2. **Domain Name**: Purchased and ready to configure
3. **Local Development**: Working local setup (see LOCAL_SETUP.md)
4. **Git Repository**: Code pushed to GitHub/GitLab

## Step 1: Create DigitalOcean Resources

### 1.1 Create Droplet

1. **DigitalOcean Dashboard** → **Create** → **Droplet**
2. **Choose Image**: Ubuntu 22.04 LTS
3. **Choose Size**: 
   - **Basic**: $12/month (2 GB RAM, 1 vCPU, 50 GB SSD)
   - **Recommended**: $24/month (4 GB RAM, 2 vCPU, 80 GB SSD)
4. **Authentication**: SSH keys (recommended) or password
5. **Hostname**: `autominer-production`
6. **Tags**: `autominer`, `production`
7. Click **Create Droplet**

### 1.2 Create Managed Database

1. **DigitalOcean Dashboard** → **Create** → **Database**
2. **Database Engine**: PostgreSQL 15
3. **Plan**: 
   - **Basic**: $15/month (1 GB RAM, 1 vCPU, 10 GB storage)
   - **Recommended**: $30/month (2 GB RAM, 1 vCPU, 20 GB storage)
4. **Datacenter**: Same region as your droplet
5. **Database Name**: `autominer-db`
6. **Tags**: `autominer`, `production`
7. Click **Create Database**

### 1.3 Configure Firewall

1. **Networking** → **Firewalls** → **Create Firewall**
2. **Name**: `autominer-firewall`
3. **Inbound Rules**:
   - SSH (22) - Your IP only
   - HTTP (80) - All IPv4, All IPv6
   - HTTPS (443) - All IPv4, All IPv6
4. **Outbound Rules**: All traffic
5. **Assign to Droplet**: Select your droplet

## Step 2: Domain and DNS Configuration

### 2.1 Configure DNS

1. **DigitalOcean Dashboard** → **Networking** → **Domains**
2. **Add Domain**: Enter your domain name
3. **Add DNS Records**:
   ```
   A Record: @ → [Your Droplet IP]
   A Record: www → [Your Droplet IP]
   CNAME Record: api → @
   ```

### 2.2 Update Domain Registrar

Update your domain's nameservers to:
- `ns1.digitalocean.com`
- `ns2.digitalocean.com`  
- `ns3.digitalocean.com`

## Step 3: Server Setup

### 3.1 Connect to Droplet

```bash
# SSH into your droplet
ssh root@your-droplet-ip

# Update system
apt update && apt upgrade -y
```

### 3.2 Install Required Software

```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install Git
apt install -y git

# Install certbot for SSL
apt install -y certbot python3-certbot-nginx

# Install PostgreSQL client (for testing)
apt install -y postgresql-client
```

### 3.3 Create Application User

```bash
# Create user for the application
adduser --system --group --home /var/www/autominer autominer

# Add to sudo group (if needed)
usermod -aG sudo autominer

# Switch to application user
su - autominer
```

## Step 4: Deploy Application

### 4.1 Clone Repository

```bash
# As autominer user
cd /var/www/autominer
git clone https://github.com/yourusername/autominer.git .

# Set up directory permissions
sudo chown -R autominer:autominer /var/www/autominer
sudo chmod -R 755 /var/www/autominer
```

### 4.2 Install Dependencies

```bash
# Install backend dependencies
cd /var/www/autominer/backend
npm install --production

# Install frontend dependencies and build
cd /var/www/autominer/frontend
npm install
npm run build
```

### 4.3 Configure Environment Variables

```bash
# Create production environment file
cd /var/www/autominer/backend
cp .env.example .env.production
```

Edit `/var/www/autominer/backend/.env.production`:
```env
# Database (from DigitalOcean Database)
DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require"

# JWT Secret (generate new for production)
JWT_SECRET="your-super-secure-jwt-secret-here"

# OpenAI
OPENAI_API_KEY="sk-your-openai-key-here"

# Slack OAuth
SLACK_CLIENT_ID="your-slack-client-id"
SLACK_CLIENT_SECRET="your-slack-client-secret"
SLACK_REDIRECT_URI="https://yourdomain.com/slack/callback"

# Pipedream
PIPEDREAM_API_KEY="your-pipedream-api-key"

# Server
PORT=5000
NODE_ENV=production
CORS_ORIGIN="https://yourdomain.com"
```

### 4.4 Database Migration

```bash
# Run database migrations
cd /var/www/autominer/backend
npx prisma migrate deploy
npx prisma generate
```

## Step 5: Configure Nginx

### 5.1 Create Nginx Configuration

```bash
# Create Nginx site configuration
sudo nano /etc/nginx/sites-available/autominer
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend (React build)
    location / {
        root /var/www/autominer/frontend/build;
        try_files $uri $uri/ /index.html;
        
        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 10240;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
}
```

### 5.2 Enable Site

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/autominer /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## Step 6: SSL Certificate Setup

### 6.1 Install SSL Certificate

```bash
# Install SSL certificate with Let's Encrypt
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test automatic renewal
sudo certbot renew --dry-run
```

### 6.2 Configure Auto-renewal

```bash
# Add cron job for automatic renewal
sudo crontab -e

# Add this line:
0 12 * * * /usr/bin/certbot renew --quiet
```

## Step 7: Process Management with PM2

### 7.1 Create PM2 Configuration

```bash
# Create PM2 ecosystem file
cd /var/www/autominer
nano ecosystem.config.js
```

Add PM2 configuration:

```javascript
module.exports = {
  apps: [
    {
      name: 'autominer-backend',
      script: './backend/server.js',
      cwd: '/var/www/autominer',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      env_file: './backend/.env.production',
      instances: 1,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};
```

### 7.2 Start Application

```bash
# Create logs directory
mkdir -p /var/www/autominer/logs

# Start application with PM2
cd /var/www/autominer
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions provided by the command
```

## Step 8: Configure Production Slack App

### 8.1 Update Slack App Settings

1. Go to https://api.slack.com/apps
2. Select your AutoMiner app
3. **OAuth & Permissions** → **Redirect URLs**:
   - Remove: `http://localhost:3000/slack/callback`
   - Add: `https://yourdomain.com/slack/callback`
4. **Save Changes**

### 8.2 Update Pipedream Workflows

1. Go to your Pipedream dashboard
2. Update webhook URL: `https://yourdomain.com/api/slack/webhook`
3. Test the webhook connection

## Step 9: Monitoring and Maintenance

### 9.1 Set up Monitoring

```bash
# Install monitoring tools
npm install -g pm2-logrotate

# Configure log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### 9.2 Create Backup Script

```bash
# Create backup script
sudo nano /usr/local/bin/backup-autominer.sh
```

Add backup script:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/autominer"
DB_NAME="your-db-name"
DB_USER="your-db-user"
DB_HOST="your-db-host"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
PGPASSWORD="your-db-password" pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > $BACKUP_DIR/db_backup_$DATE.sql

# Backup application files
tar -czf $BACKUP_DIR/app_backup_$DATE.tar.gz -C /var/www/autominer .

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

```bash
# Make script executable
sudo chmod +x /usr/local/bin/backup-autominer.sh

# Add to cron for daily backups
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-autominer.sh
```

### 9.3 System Monitoring

```bash
# Monitor PM2 processes
pm2 status
pm2 logs
pm2 monit

# Monitor system resources
htop
df -h
free -h

# Monitor Nginx
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

## Step 10: Deployment Automation

### 10.1 Create Deployment Script

```bash
# Create deployment script
nano /var/www/autominer/deploy.sh
```

Add deployment script:

```bash
#!/bin/bash
set -e

echo "Starting AutoMiner deployment..."

# Pull latest code
git pull origin main

# Install/update backend dependencies
cd /var/www/autominer/backend
npm install --production

# Run database migrations
npx prisma migrate deploy

# Build frontend
cd /var/www/autominer/frontend
npm install
npm run build

# Restart application
pm2 restart autominer-backend

echo "Deployment completed successfully!"
```

```bash
# Make script executable
chmod +x /var/www/autominer/deploy.sh
```

### 10.2 GitHub Actions (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to DigitalOcean

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - name: Deploy to server
      uses: appleboy/ssh-action@v0.1.8
      with:
        host: ${{ secrets.HOST }}
        username: ${{ secrets.USERNAME }}
        key: ${{ secrets.SSH_KEY }}
        script: |
          cd /var/www/autominer
          sudo -u autominer ./deploy.sh
```

## Verification and Testing

### 1. Check Application Status

```bash
# Check PM2 processes
pm2 status

# Check application logs
pm2 logs autominer-backend

# Check Nginx status
sudo systemctl status nginx

# Test database connection
cd /var/www/autominer/backend
node -e "console.log('Testing DB...'); require('./prisma/client').prisma.$connect().then(() => console.log('DB connected')).catch(console.error)"
```

### 2. Test Application

1. **Visit your domain**: https://yourdomain.com
2. **Register new user**: Test user registration
3. **Connect Slack**: Test OAuth flow
4. **Run analysis**: Test AI analysis
5. **Generate reports**: Test report generation

### 3. Performance Testing

```bash
# Test server response time
curl -w "%{time_total}\n" -o /dev/null -s https://yourdomain.com

# Test API endpoints
curl -X POST https://yourdomain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## Troubleshooting

### Common Issues

1. **502 Bad Gateway**: Check if backend is running (`pm2 status`)
2. **Database connection issues**: Verify DATABASE_URL in env file
3. **SSL certificate issues**: Check certbot logs (`sudo certbot certificates`)
4. **Slack OAuth issues**: Verify redirect URLs match exactly

### Log Locations

- **Application logs**: `/var/www/autominer/logs/`
- **Nginx logs**: `/var/log/nginx/`
- **PM2 logs**: `pm2 logs`
- **System logs**: `/var/log/syslog`

### Performance Optimization

```bash
# Enable HTTP/2 in Nginx
# Add to server block: listen 443 ssl http2;

# Optimize PM2 for production
pm2 start ecosystem.config.js --update-env

# Monitor resource usage
pm2 monit
```

## Security Checklist

- [ ] SSH key authentication enabled
- [ ] Firewall configured properly
- [ ] SSL certificate installed and auto-renewing
- [ ] Database uses SSL connections
- [ ] Environment variables secured
- [ ] Regular backups configured
- [ ] Application runs as non-root user
- [ ] Nginx security headers configured
- [ ] PM2 process monitoring active

## Maintenance Tasks

### Daily
- Check application status (`pm2 status`)
- Monitor resource usage
- Review error logs

### Weekly
- Update system packages (`apt update && apt upgrade`)
- Check backup integrity
- Review security logs

### Monthly
- Update Node.js dependencies
- Test disaster recovery procedures
- Review and optimize database performance

## Support

If you encounter deployment issues:
1. Check all logs mentioned above
2. Verify environment variables are correct
3. Ensure all services are running
4. Test each component individually
5. Check firewall and DNS settings

Your AutoMiner application should now be live at https://yourdomain.com! 