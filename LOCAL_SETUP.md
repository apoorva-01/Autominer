# AutoMiner - Local Development Setup

## Prerequisites

### 1. Install Required Software

**Node.js and npm:**
```bash
# Install Node.js 18+ (recommended: use nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

**PostgreSQL:**
```bash
# macOS (using Homebrew)
brew install postgresql
brew services start postgresql

# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

**Git:**
```bash
# macOS
brew install git

# Ubuntu/Debian
sudo apt install git

# Windows
# Download from https://git-scm.com/download/win
```

### 2. Create Required Accounts

1. **OpenAI Account**: Get API key from https://platform.openai.com/
2. **Slack App**: Create at https://api.slack.com/apps
3. **Pipedream Account**: Sign up at https://pipedream.com/

## Step 1: Clone and Setup Project

```bash
# Clone the repository
git clone <your-repo-url>
cd Lifechanging

# Install dependencies for both frontend and backend
cd backend
npm install
cd ../frontend
npm install
cd ..
```

## Step 2: Database Setup

### Create Database and User

```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE autominer;
CREATE USER autominer_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE autominer TO autominer_user;
\q
```

### Run Database Migrations

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

## Step 3: Environment Configuration

### Backend Environment (.env)

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
# Database
DATABASE_URL="postgresql://autominer_user:your_secure_password@localhost:5432/autominer"

# JWT Secret (generate with: openssl rand -hex 32)
JWT_SECRET="your-jwt-secret-here"

# OpenAI
OPENAI_API_KEY="sk-your-openai-key-here"

# Slack OAuth
SLACK_CLIENT_ID="your-slack-client-id"
SLACK_CLIENT_SECRET="your-slack-client-secret"
SLACK_REDIRECT_URI="http://localhost:3000/slack/callback"

# Pipedream
PIPEDREAM_API_KEY="your-pipedream-api-key"

# Server
PORT=5000
NODE_ENV=development
CORS_ORIGIN="http://localhost:3000"
```

### Frontend Environment (.env)

```bash
cd ../frontend
cp .env.example .env
```

Edit `frontend/.env`:
```env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_SLACK_CLIENT_ID=your-slack-client-id
```

## Step 4: Slack App Configuration

### Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. App Name: "AutoMiner"
4. Workspace: Choose your development workspace

### Configure OAuth & Permissions

1. **OAuth & Permissions** → **Scopes**:
   - `channels:read` - View basic information about public channels
   - `channels:history` - View messages in public channels
   - `groups:read` - View basic information about private channels
   - `groups:history` - View messages in private channels
   - `im:read` - View basic information about direct messages
   - `im:history` - View messages in direct messages
   - `users:read` - View people in the workspace

2. **Redirect URLs**:
   - Development: `http://localhost:3000/slack/callback`
   - Production: `https://yourdomain.com/slack/callback`

### Get Credentials

1. **Basic Information** → Copy:
   - Client ID
   - Client Secret
2. Add these to your `.env` files

## Step 5: Pipedream Setup

### Create Pipedream Account

1. Sign up at https://pipedream.com/
2. Go to Account Settings → API Keys
3. Generate new API key
4. Add to `backend/.env`

### Create Slack Connection Workflow

1. In Pipedream dashboard, create new workflow
2. Add Slack trigger: "New Message in Channel"
3. Add HTTP Request step to send data to your local API
4. Webhook URL: `http://localhost:5000/api/slack/webhook`

## Step 6: Running the Application

### Terminal 1: Start Backend

```bash
cd backend
npm run dev
```

Backend will start on http://localhost:5000

### Terminal 2: Start Frontend

```bash
cd frontend
npm start
```

Frontend will start on http://localhost:3000

### Terminal 3: Database GUI (Optional)

```bash
cd backend
npx prisma studio
```

Prisma Studio will open at http://localhost:5555

## Step 7: Testing the Setup

### 1. Register a User

1. Open http://localhost:3000
2. Click "Sign Up"
3. Create account with email/password

### 2. Connect Slack Workspace

1. Login to your account
2. Go to "Slack Connections"
3. Click "Connect New Workspace"
4. Complete OAuth flow

### 3. Run Analysis

1. Go to "AI Analysis"
2. Select connected workspace
3. Click "Start Analysis"
4. Wait for results

### 4. View Reports

1. Go to "Reports"
2. Generate new report
3. Export as JSON/CSV

## Common Issues and Solutions

### Database Connection Issues

```bash
# Check if PostgreSQL is running
brew services list | grep postgresql  # macOS
sudo systemctl status postgresql      # Linux

# Reset database if needed
cd backend
npx prisma migrate reset
```

### Port Conflicts

```bash
# Check what's using port 5000
lsof -i :5000

# Kill process if needed
kill -9 <PID>
```

### Node Modules Issues

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### OpenAI API Issues

- Ensure you have credits in your OpenAI account
- Check API key format (starts with `sk-`)
- Verify rate limits aren't exceeded

## Development Tips

### Hot Reload

Both frontend and backend support hot reload:
- Backend: Uses `nodemon` for automatic restarts
- Frontend: Uses React's built-in hot reload

### Database Schema Changes

```bash
# After modifying schema.prisma
cd backend
npx prisma migrate dev --name your-migration-name
npx prisma generate
```

### API Testing

Use the included Postman collection or curl:

```bash
# Test user registration
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Test authentication
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

### Logs and Debugging

```bash
# Backend logs
cd backend
npm run dev

# Frontend logs
cd frontend
npm start

# Database logs
tail -f /usr/local/var/log/postgresql/*.log  # macOS
sudo journalctl -u postgresql -f             # Linux
```

## Next Steps

Once local development is working:
1. Test all features thoroughly
2. Review deployment guide (DEPLOYMENT.md)
3. Set up production environment variables
4. Configure production Slack app settings

## Support

If you encounter issues:
1. Check the console logs for error messages
2. Verify all environment variables are set correctly
3. Ensure all services (PostgreSQL, Node.js) are running
4. Check firewall settings for port access 