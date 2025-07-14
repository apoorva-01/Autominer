const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearDatabase() {
  console.log('🗑️  Starting database cleanup...');
  
  try {
    // Delete in order to respect foreign key constraints
    
    console.log('📊 Deleting automation report tasks...');
    await prisma.automationReportTask.deleteMany({});
    
    console.log('📋 Deleting automation reports...');
    await prisma.automationReport.deleteMany({});
    
    console.log('🤖 Deleting automation tasks...');
    await prisma.automationTask.deleteMany({});
    
    console.log('💬 Deleting slack conversations...');
    await prisma.slackConversation.deleteMany({});
    
    console.log('📡 Deleting slack scraping jobs...');
    await prisma.slackScrapingJob.deleteMany({});
    
    console.log('📺 Deleting slack channel selections...');
    await prisma.slackChannelSelection.deleteMany({});
    
    console.log('🔗 Deleting slack connections...');
    await prisma.slackConnection.deleteMany({});
    
    console.log('👤 Deleting users...');
    await prisma.user.deleteMany({});
    
    console.log('✅ Database cleared successfully!');
    
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the cleanup
clearDatabase()
  .then(() => {
    console.log('🎉 Database cleanup completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Database cleanup failed:', error);
    process.exit(1);
  }); 