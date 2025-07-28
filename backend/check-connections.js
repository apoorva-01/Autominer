const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // Get all connections
    const connections = await prisma.slackConnection.findMany();
    console.log('Total connections:', connections.length);
    console.log('Connections:', JSON.stringify(connections.map(c => ({
      id: c.id,
      userId: c.userId,
      slackTeamId: c.slackTeamId,
      slackTeamName: c.slackTeamName,
      isActive: c.isActive,
      createdAt: c.createdAt
    })), null, 2));

    // Get all conversations
    const conversations = await prisma.slackConversation.findMany();
    console.log('\nTotal conversations:', conversations.length);
    
    // Group conversations by connection
    const conversationsByConnection = {};
    for (const convo of conversations) {
      if (!conversationsByConnection[convo.slackConnectionId]) {
        conversationsByConnection[convo.slackConnectionId] = [];
      }
      conversationsByConnection[convo.slackConnectionId].push(convo);
    }
    
    console.log('\nConversations per connection:');
    for (const connectionId in conversationsByConnection) {
      console.log(`- Connection ${connectionId}: ${conversationsByConnection[connectionId].length} conversations`);
    }

    // Check if there are any unused connections (connections without conversations)
    const unusedConnections = connections.filter(conn => 
      !conversationsByConnection[conn.id] || conversationsByConnection[conn.id].length === 0
    );
    
    console.log('\nUnused connections (no conversations):', unusedConnections.length);
    if (unusedConnections.length > 0) {
      console.log(JSON.stringify(unusedConnections.map(c => ({
        id: c.id,
        userId: c.userId,
        slackTeamId: c.slackTeamId,
        slackTeamName: c.slackTeamName
      })), null, 2));
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main(); 