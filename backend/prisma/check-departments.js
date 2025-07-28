const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDepartments() {
  try {
    // Get all departments
    const departments = await prisma.department.findMany();
    console.log('=== Departments ===');
    console.log(JSON.stringify(departments, null, 2));
    
    // Check department assignments
    const departmentAssignments = await prisma.departmentAssignment.findMany();
    console.log('\n=== Department Assignments ===');
    console.log(JSON.stringify(departmentAssignments, null, 2));
    
    // Get connection information
    const connections = await prisma.slackConnection.findMany({
      where: { isActive: true }
    });
    console.log('\n=== Slack Connections ===');
    console.log(JSON.stringify(connections.map(c => ({
      id: c.id,
      slackTeamId: c.slackTeamId,
      slackTeamName: c.slackTeamName,
      isActive: c.isActive
    })), null, 2));
    
    // Check if departments have any conversations
    if (departments.length > 0) {
      const departmentIds = departments.map(d => d.id);
      const departmentUsers = {};
      
      // Get users for each department
      for (const deptId of departmentIds) {
        const assignments = await prisma.departmentAssignment.findMany({
          where: { department: deptId }
        });
        departmentUsers[deptId] = assignments.map(a => a.userId);
      }
      
      // Check conversations for each department's users
      console.log('\n=== Department User Conversations ===');
      for (const [deptId, userIds] of Object.entries(departmentUsers)) {
        if (userIds.length === 0) {
          console.log(`Department ${deptId} has no assigned users`);
          continue;
        }
        
        const conversations = await prisma.slackConversation.findMany({
          where: { userId: { in: userIds } },
          take: 5
        });
        
        console.log(`Department ${deptId} users (${userIds.length}) have ${conversations.length} conversations (showing up to 5)`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDepartments().then(() => console.log('Done!')); 