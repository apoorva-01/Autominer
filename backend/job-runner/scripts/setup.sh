#!/bin/bash

# Job Runner Setup Script

echo "🚀 Setting up Job Runner Service..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp environment.example .env
    echo "⚠️  Please update .env file with your configuration"
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Check database connection
echo "🔍 Testing database connection..."
if npx prisma db push --accept-data-loss; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed. Please check your DATABASE_URL in .env"
    exit 1
fi

echo "✅ Job Runner setup complete!"
echo ""
echo "To start the job runner:"
echo "  npm run dev    # Development mode"
echo "  npm start      # Production mode"
echo ""
echo "To check if it's running:"
echo "  curl http://localhost:3002/health" 