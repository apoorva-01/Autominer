const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // Get all users
    const users = await prisma.user.findMany();
    console.log('Total users:', users.length);
    console.log('Users:', JSON.stringify(users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role
    })), null, 2));

    // Get all connections
    const connections = await prisma.slackConnection.findMany();
    
    // Group connections by user
    const connectionsByUser = {};
    for (const conn of connections) {
      if (!connectionsByUser[conn.userId]) {
        connectionsByUser[conn.userId] = [];
      }
      connectionsByUser[conn.userId].push(conn);
    }
    
    console.log('\nConnections per user:');
    for (const userId in connectionsByUser) {
      const user = users.find(u => u.id === userId);
      console.log(`- User ${user?.email || userId}: ${connectionsByUser[userId].length} connections`);
      
      // List connections for this user
      connectionsByUser[userId].forEach(conn => {
        console.log(`  * ${conn.slackTeamName} (${conn.slackTeamId}): ${conn.isActive ? 'active' : 'inactive'}`);
      });
    }

    // Check if there are any users without connections
    const usersWithoutConnections = users.filter(user => 
      !connectionsByUser[user.id] || connectionsByUser[user.id].length === 0
    );
    
    console.log('\nUsers without connections:', usersWithoutConnections.length);
    if (usersWithoutConnections.length > 0) {
      console.log(JSON.stringify(usersWithoutConnections.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role
      })), null, 2));
    }

    // Check backup issue specifically
    console.log('\nAnalyzing the backup issue:');
    const userWithMultipleConnections = Object.keys(connectionsByUser).filter(
      userId => connectionsByUser[userId].length > 1
    );
    
    if (userWithMultipleConnections.length > 0) {
      console.log(`Found ${userWithMultipleConnections.length} users with multiple connections`);
      
      for (const userId of userWithMultipleConnections) {
        const user = users.find(u => u.id === userId);
        console.log(`\nUser ${user?.email || userId} has ${connectionsByUser[userId].length} connections:`);
        
        // Check conversation counts per connection for this user
        for (const conn of connectionsByUser[userId]) {
          const conversationCount = await prisma.slackConversation.count({
            where: { slackConnectionId: conn.id }
          });
          
          console.log(`- Connection ${conn.id} (${conn.slackTeamName}): ${conversationCount} conversations`);
        }
      }
    } else {
      console.log('No users with multiple connections found.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main(); 