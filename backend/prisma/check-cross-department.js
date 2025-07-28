const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCrossDepartmentConversations() {
  try {
    // Get the departments we're interested in
    const departmentIds = [
      'cmd88eak40009xwuh9xktjhg9', // HR
      'cmd88ef8y000axwuhi8k6pv4u', // Operations
      'cmd88eog6000cxwuhsok0xp5a', // Sales
      'cmd88ei73000bxwuh7p4jfypr'  // Tech
    ];
    
    // 1. Get the connection ID
    const connections = await prisma.slackConnection.findMany({
      where: { slackTeamId: 'T1KN22JBV', isActive: true }
    });
    
    if (connections.length === 0) {
      console.log('No active connections found for team T1KN22JBV');
      return;
    }
    
    console.log(`Found ${connections.length} active connections for team T1KN22JBV`);
    const connectionIds = connections.map(c => c.id);
    
    // 2. Get department user assignments
    const departmentUsers = {};
    const allUserIds = [];
    for (const deptId of departmentIds) {
      const assignments = await prisma.departmentAssignment.findMany({
        where: { 
          department: deptId,
          connectionId: { in: connectionIds }
        }
      });
      departmentUsers[deptId] = assignments.map(a => a.userId);
      allUserIds.push(...assignments.map(a => a.userId));
    }
    
    console.log('Department user counts:');
    for (const [deptId, users] of Object.entries(departmentUsers)) {
      console.log(`- Department ${deptId}: ${users.length} users`);
    }
    
    // 3. Get DM conversations between these users
    console.log('\nChecking for cross-department DMs...');
    const dmConversations = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds },
        messageType: 'dm',
        userId: { in: allUserIds },
        participants: { hasSome: allUserIds }
      },
      take: 100 // Limit to 100 conversations for testing
    });
    
    console.log(`Found ${dmConversations.length} total DM conversations among all users`);
    
    // 4. Find cross-department conversations
    console.log('\nAnalyzing for cross-department patterns:');
    const crossDeptConversations = [];
    
    for (const conv of dmConversations) {
      // Find sender's department
      const senderDeptId = Object.entries(departmentUsers).find(
        ([deptId, users]) => users.includes(conv.userId)
      )?.[0];
      
      if (!senderDeptId) continue; // Skip if sender isn't in our tracked departments
      
      // Check participants for users from different departments
      const participantDepartments = new Set();
      participantDepartments.add(senderDeptId);
      
      for (const participantId of conv.participants) {
        for (const [deptId, users] of Object.entries(departmentUsers)) {
          if (users.includes(participantId) && deptId !== senderDeptId) {
            participantDepartments.add(deptId);
          }
        }
      }
      
      // If participants from more than one department, it's cross-department
      if (participantDepartments.size > 1) {
        crossDeptConversations.push({
          id: conv.id,
          sender: conv.userId,
          participants: conv.participants,
          departments: Array.from(participantDepartments),
          messageText: conv.messageText?.substring(0, 50) + '...'
        });
      }
    }
    
    console.log(`Found ${crossDeptConversations.length} cross-department DM conversations`);
    
    if (crossDeptConversations.length > 0) {
      console.log('\nSample cross-department conversations:');
      console.log(JSON.stringify(crossDeptConversations.slice(0, 3), null, 2));
    }
    
    // 5. Check for shared channels
    console.log('\nChecking for shared channels...');
    const departmentNames = ['HR', 'Operations', 'Tech', 'Sales'];
    const channelConversations = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds },
        messageType: 'channel',
        userId: { in: allUserIds }
      },
      distinct: ['channelId', 'channelName']
    });
    
    console.log(`Found ${channelConversations.length} distinct channels`);
    
    // 6. Check if any channels have participants from multiple departments
    const channelParticipants = {};
    for (const conv of channelConversations) {
      if (!channelParticipants[conv.channelId]) {
        channelParticipants[conv.channelId] = {
          channelName: conv.channelName || conv.channelId,
          participants: new Set(),
          departments: new Set()
        };
      }
      
      // Add the sender's department
      const senderDeptId = Object.entries(departmentUsers).find(
        ([deptId, users]) => users.includes(conv.userId)
      )?.[0];
      
      if (senderDeptId) {
        channelParticipants[conv.channelId].participants.add(conv.userId);
        channelParticipants[conv.channelId].departments.add(senderDeptId);
      }
      
      // Add participants' departments
      if (Array.isArray(conv.participants)) {
        for (const participantId of conv.participants) {
          for (const [deptId, users] of Object.entries(departmentUsers)) {
            if (users.includes(participantId)) {
              channelParticipants[conv.channelId].participants.add(participantId);
              channelParticipants[conv.channelId].departments.add(deptId);
            }
          }
        }
      }
    }
    
    // Find channels with multiple departments
    const sharedChannels = Object.entries(channelParticipants)
      .filter(([_, data]) => data.departments.size > 1)
      .map(([channelId, data]) => ({
        channelId,
        channelName: data.channelName,
        departments: Array.from(data.departments),
        participantCount: data.participants.size
      }));
    
    console.log(`Found ${sharedChannels.length} channels shared between multiple departments`);
    
    if (sharedChannels.length > 0) {
      console.log('\nShared channels:');
      console.log(JSON.stringify(sharedChannels.slice(0, 5), null, 2));
    }
    
    // Check for the "no common managers" part
    console.log('\nChecking manager relationships...');
    
    // Get all manager assignments
    const managerAssignments = await prisma.departmentAssignment.findMany({
      where: {
        department: { in: departmentIds },
        connectionId: { in: connectionIds },
        managerId: { not: null }
      }
    });
    
    // Build manager->department map
    const managerToDepartments = {};
    for (const assignment of managerAssignments) {
      if (!managerToDepartments[assignment.managerId]) {
        managerToDepartments[assignment.managerId] = new Set();
      }
      managerToDepartments[assignment.managerId].add(assignment.department);
    }
    
    // Find common managers (across multiple departments)
    const commonManagers = Object.entries(managerToDepartments)
      .filter(([_, depts]) => depts.size > 1)
      .map(([managerId, depts]) => ({
        managerId,
        departments: Array.from(depts)
      }));
    
    console.log(`Found ${commonManagers.length} managers managing users in multiple departments`);
    
    if (commonManagers.length > 0) {
      console.log('\nCommon managers:');
      console.log(JSON.stringify(commonManagers, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCrossDepartmentConversations().then(() => console.log('Done!')); 