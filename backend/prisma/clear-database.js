const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TABLES = [
  'automationReportTask',
  'automationReport',
  'automationTask',
  'DepartmentRole',
  'Department',
  'DepartmentAssignment',
  'Role',
  'slackConversation',
  'slackScrapingJob',
  // 'slackChannelGoogleDoc',
  // 'slackChannelSelection',
  // 'slackConnection',
  // 'user'
];

async function clearDatabase(targetTable = 'all') {
  console.log('🗑️  Starting database cleanup...');
  try {
    if (targetTable === 'all') {
      // Delete in order to respect foreign key constraints
      for (const table of TABLES) {
        console.log(`Deleting all from ${table}...`);
        await prisma[table].deleteMany({});
      }
      console.log('✅ All tables cleared successfully!');
    } else if (TABLES.includes(targetTable)) {
      console.log(`Deleting all from ${targetTable}...`);
      await prisma[targetTable].deleteMany({});
      console.log(`✅ Table ${targetTable} cleared successfully!`);
    } else {
      console.error(`❌ Unknown table: ${targetTable}`);
      console.log('Available tables:', TABLES.join(', '));
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// CLI usage: node clear-database.js [tableName|all]
const arg = process.argv[2] || 'all';
clearDatabase(arg)
  .then(() => {
    console.log('🎉 Database cleanup completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Database cleanup failed:', error);
    process.exit(1);
  }); 