const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');

// Use a single Prisma instance throughout the application
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Performance debugging
const DEBUG_PERF = true;

// Constants for pagination and query optimization
const DEFAULT_PAGE_SIZE = 50;
const MAX_CONVERSATIONS = 1000;

function logPerformance(operation, startTime) {
  if (!DEBUG_PERF) return;
  const duration = Date.now() - startTime;
  console.log(`[PERF] ${operation} completed in ${duration}ms`);
  if (duration > 1000) {
    console.warn(`⚠️ [SLOW OPERATION] ${operation} took ${duration}ms to complete`);
  }
}

// Helper to optimize database query with pagination
async function paginatedQuery(queryFn, options = {}) {
  const { pageSize = DEFAULT_PAGE_SIZE, maxItems = MAX_CONVERSATIONS } = options;
  let allResults = [];
  let page = 0;
  let hasMore = true;
  
  while (hasMore && allResults.length < maxItems) {
    const results = await queryFn(page, pageSize);
    if (!results.length) {
      hasMore = false;
    } else {
      allResults = [...allResults, ...results];
      page++;
    }
    
    if (allResults.length >= maxItems) {
      console.warn(`[WARNING] Reached maximum results limit (${maxItems}), truncating results`);
      allResults = allResults.slice(0, maxItems);
      hasMore = false;
    }
  }
  
  return allResults;
}

// Helper function to get department user assignments - optimized with select and where
async function getDepartmentUsers(departmentId, connectionId) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching department users for department: ${departmentId}, connectionId: ${connectionId}`);
  
  try {
    // Use select to only get needed fields
    const assignments = await prisma.departmentAssignment.findMany({ 
      where: { department: departmentId, connectionId },
      select: {
        userId: true,
        managerId: true
      }
    });
    
    logPerformance(`Fetching department users for ${departmentId}`, startTime);
    
    // Process results efficiently
    const userIds = assignments.map(a => a.userId);
    const managerMap = {};
    
    // Build manager map in a single pass
    for (const a of assignments) {
      if (a.managerId) {
        managerMap[a.userId] = a.managerId;
      }
    }
    
    return { userIds, managerMap };
  } catch (error) {
    console.error(`[ERROR] Failed to get department users: ${error.message}`);
    throw error;
  }
}

// Helper function to get connections for a team - optimized
async function getConnectionsForTeam(slackTeamId) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching connections for slackTeamId: ${slackTeamId}`);
  
  try {
    const connections = await prisma.slackConnection.findMany({
      where: { slackTeamId, isActive: true },
      select: { id: true },
      take: 100 // Add a reasonable limit
    });
    
    logPerformance(`Fetching connections for team ${slackTeamId}`, startTime);
    return connections.map(c => c.id);
  } catch (error) {
    console.error(`[ERROR] Failed to get connections for team: ${error.message}`);
    return [];
  }
}

// Improved: Get all conversations for intra-department analysis with pagination and direct filtering
async function getIntraDepartmentConversations(connectionId, department) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching intra-department conversations for department: ${department}`);
  
  try {
    // Get department info to get slackTeamId
    const departmentInfo = await prisma.department.findUnique({
      where: { id: department },
      select: { slackTeamId: true, name: true }
    });
    
    if (!departmentInfo) {
      console.error(`Department ${department} not found`);
      return [];
    }
    
    const slackTeamId = departmentInfo.slackTeamId;
    const deptName = departmentInfo.name;
    console.log(`[DEBUG] Department ${department} has slackTeamId: ${slackTeamId}`);
    
    // Find all connections for this slackTeamId (with limit)
    const connectionIds = await getConnectionsForTeam(slackTeamId);
    console.log(`[DEBUG] Found ${connectionIds.length} connections for slackTeamId ${slackTeamId}`);
    
    // Get all assignments for this department
    const { userIds, managerMap } = await getDepartmentUsers(department, connectionId);
    console.log(`[DEBUG] Department ${department} has ${userIds.length} users`);
    
    // Get the different conversation types
    console.log(`[DEBUG] Fetching different conversation types for department ${department}`);
    const conversationStartTime = Date.now();
    
    // Use Promise.all for parallel fetching but with each method implementing pagination
    const [internalDMs, supervisorDMs, supervisorManagerDMs, departmentChannels] = await Promise.all([
      getDepartmentInternalDMs(connectionIds, userIds),
      getSupervisorDMs(connectionIds, userIds, managerMap),
      getSupervisorManagerDMs(connectionIds, userIds, managerMap),
      getDepartmentChannels(connectionIds, deptName)
    ]);
    
    logPerformance(`Fetching all conversation types for department ${department}`, conversationStartTime);
    
    // Use the deduplicateConversations function to combine results efficiently
    const allConversations = [
      ...internalDMs,
      ...supervisorDMs,
      ...supervisorManagerDMs, 
      ...departmentChannels
    ];
    
    const result = deduplicateConversations(allConversations);
    console.log(`[DEBUG] Found ${result.length} total conversations for department ${department}`);
    
    logPerformance(`Getting all intra-department conversations for ${department}`, startTime);
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to get intra-department conversations: ${error.message}`);
    return [];
  }
}

// Optimized helper: Get DMs between department members with direct DB filtering
async function getDepartmentInternalDMs(connectionIds, userIds) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching internal DMs for ${userIds.length} users across ${connectionIds.length} connections`);
  
  try {
    // Early return if no users or connections
    if (!userIds.length || !connectionIds.length) return [];
    
    // Use paginatedQuery for automatic pagination
    const queryFn = async (page, pageSize) => {
      return await prisma.slackConversation.findMany({
        where: {
          slackConnectionId: { in: connectionIds },
          messageType: 'dm',
          userId: { in: userIds },
          participants: { hasSome: userIds },
        },
        skip: page * pageSize,
        take: pageSize
      });
    };
    
    const intraDeptDMs = await paginatedQuery(queryFn);
    
    // Filter only if needed - use Set for O(1) lookups of userIds
    const userIdSet = new Set(userIds);
    const filtered = intraDeptDMs.filter(dm =>
      dm.participants.every(pid => userIdSet.has(pid)) && userIdSet.has(dm.userId)
    );
    
    console.log(`[DEBUG] Found ${filtered.length} internal DMs (from ${intraDeptDMs.length} initial matches)`);
    logPerformance('Fetching department internal DMs', startTime);
    
    return filtered;
  } catch (error) {
    console.error(`[ERROR] Failed to get department internal DMs: ${error.message}`);
    return [];
  }
}

// Optimized helper: Get DMs between members and supervisors
async function getSupervisorDMs(connectionIds, userIds, managerMap) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching supervisor DMs for ${Object.keys(managerMap).length} reporting relationships`);
  
  try {
    // Early return if no manager relationships
    if (Object.keys(managerMap).length === 0 || !connectionIds.length) return [];
    
    // Create arrays of user-manager pairs with efficient Set operations
    const employeeIds = Object.keys(managerMap);
    const managerIds = Object.values(managerMap);
    
    // More efficient Set creation - avoid unnecessary array spreading
    const uniqueUserIdsSet = new Set();
    employeeIds.forEach(id => uniqueUserIdsSet.add(id));
    managerIds.forEach(id => uniqueUserIdsSet.add(id));
    const uniqueUserIds = Array.from(uniqueUserIdsSet);
    
    // Use the paginatedQuery helper for automatic pagination
    const queryFn = async (page, pageSize) => {
      return await prisma.slackConversation.findMany({
        where: {
          slackConnectionId: { in: connectionIds },
          messageType: 'dm',
          OR: [
            {
              userId: { in: uniqueUserIds },
              participants: { hasSome: uniqueUserIds }
            }
          ]
        },
        orderBy: { slackSentAt: 'desc' }, // Adding ordering for deterministic pagination
        skip: page * pageSize,
        take: pageSize
      });
    };
    
    // Use pagination helper instead of arbitrary take limit
    const results = await paginatedQuery(queryFn, {
      pageSize: DEFAULT_PAGE_SIZE,
      maxItems: MAX_CONVERSATIONS
    });
    
    // Filter results in memory to find actual supervisor-employee DMs
    const supervisorDMs = results.filter(dm => {
      // Check if this is a conversation between manager and their direct report
      for (const [employeeId, managerId] of Object.entries(managerMap)) {
        // Check both directions of conversation
        if ((dm.userId === employeeId && dm.participants.includes(managerId)) ||
            (dm.userId === managerId && dm.participants.includes(employeeId))) {
          return true;
        }
      }
      return false;
    });
    
    console.log(`[DEBUG] Found ${supervisorDMs.length} supervisor-employee DMs from ${results.length} candidate conversations`);
    logPerformance('Fetching supervisor DMs', startTime);
    
    return supervisorDMs;
  } catch (error) {
    console.error(`[ERROR] Failed to get supervisor DMs: ${error.message}`);
    return [];
  }
}

// Optimized helper: Get DMs between supervisors and their managers
async function getSupervisorManagerDMs(connectionIds, userIds, managerMap) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching supervisor-manager DMs`);
  
  try {
    // Early returns for efficiency
    if (Object.keys(managerMap).length === 0 || !connectionIds.length) return [];
    
    // Get manager-of-manager relationships
    const managerOfManagerIds = new Set();
    const managerToTheirManager = {};
    
    for (const [userId, managerId] of Object.entries(managerMap)) {
      if (managerMap[managerId]) { // Manager has a manager
        managerOfManagerIds.add(managerId); // This is a middle-manager
        managerOfManagerIds.add(managerMap[managerId]); // This is a higher-level manager
        managerToTheirManager[managerId] = managerMap[managerId];
      }
    }
    
    if (managerOfManagerIds.size === 0) return [];
    
    // Get all IDs we need to query
    const relevantIds = [...managerOfManagerIds];
    
    // Execute a single query instead of batches
    const allPossibleConversations = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds },
        messageType: 'dm',
        OR: [
          { userId: { in: relevantIds } },
          { participants: { hasSome: relevantIds } }
        ]
      },
      take: 1000 // Reasonable limit for safety
    });
    
    // Filter in memory to find actual supervisor-manager DMs
    const result = allPossibleConversations.filter(dm => {
      for (const [middleManagerId, seniorManagerId] of Object.entries(managerToTheirManager)) {
        // Check both directions of conversation
        if ((dm.userId === middleManagerId && dm.participants.includes(seniorManagerId)) ||
            (dm.userId === seniorManagerId && dm.participants.includes(middleManagerId))) {
          return true;
        }
      }
      return false;
    });
    
    console.log(`[DEBUG] Found ${result.length} supervisor-manager DMs from ${allPossibleConversations.length} candidate conversations`);
    logPerformance('Fetching supervisor-manager DMs', startTime);
    
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to get supervisor-manager DMs: ${error.message}`);
    return [];
  }
}

// Optimized helper: Get department channels by name
async function getDepartmentChannels(connectionIds, deptName) {
  const startTime = Date.now();
  if (!deptName || !connectionIds.length) return [];
  
  console.log(`[DEBUG] Fetching channels for department name: ${deptName}`);
  
  try {
    // Use paginatedQuery for automatic pagination
    const queryFn = async (page, pageSize) => {
      return await prisma.slackConversation.findMany({
        where: {
          slackConnectionId: { in: connectionIds },
          messageType: 'channel',
          channelName: { contains: deptName, mode: 'insensitive' }
        },
        skip: page * pageSize,
        take: pageSize,
        distinct: ['channelId'] // Avoid duplicate channels
      });
    };
    
    const result = await paginatedQuery(queryFn);
    
    console.log(`[DEBUG] Found ${result.length} department channels for ${deptName}`);
    logPerformance(`Fetching department channels for ${deptName}`, startTime);
    
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to get department channels: ${error.message}`);
    return [];
  }
}

// Helper: Get all conversations for inter-department analysis
async function getInterDepartmentConversations(connection, departmentIds) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching inter-department conversations between ${departmentIds?.length || 0} departments`);
  
  if (!departmentIds || departmentIds.length < 2) {
    console.error('Inter-department analysis requires at least 2 departments');
    return [];
  }
  
  try {
    const connectionId = connection.id;
    const slackTeamId = connection.slackTeamId;
    
    // Find all connections for this slackTeamId (for cross-connection search)
    const connectionIds = await getConnectionsForTeam(slackTeamId);
    console.log(`[DEBUG] Found ${connectionIds.length} connections for slackTeamId ${slackTeamId}`);

    // Get department info
    const departments = await prisma.department.findMany({
      where: { id: { in: departmentIds } }
    });
    
    const departmentNames = departments.map(d => d.name.toLowerCase());
    console.log(`[DEBUG] Department names: ${departmentNames.join(', ')}`);
    
    // Important fix: Get all department assignments for all connections with this slackTeamId
    console.log(`[DEBUG] Fetching all department users across all connections for team ${slackTeamId}`);

    // Get all department assignments for the specified departments across all connections for this team
    const allDeptAssignments = await prisma.departmentAssignment.findMany({
      where: { 
        department: { in: departmentIds },
        connectionId: { in: connectionIds } // <-- Check all connections, not just the specific one
      },
      select: {
        department: true,
        userId: true
      }
    });
    
    console.log(`[DEBUG] Found ${allDeptAssignments.length} department assignments across all connections`);

    // Process in memory to build departmentUsers map
    const departmentUsers = {};
    const allUserIds = [];
    const userIdSet = new Set();

    for (const assignment of allDeptAssignments) {
      if (!departmentUsers[assignment.department]) {
        departmentUsers[assignment.department] = [];
      }
      
      departmentUsers[assignment.department].push(assignment.userId);
      
      // Add to allUserIds without duplicates
      if (!userIdSet.has(assignment.userId)) {
        allUserIds.push(assignment.userId);
        userIdSet.add(assignment.userId);
      }
    }

    // Log department user counts
    console.log(`[DEBUG] Department user counts:`);
    for (const [deptId, users] of Object.entries(departmentUsers)) {
      const deptName = departments.find(d => d.id === deptId)?.name || deptId;
      console.log(`[DEBUG] - Department ${deptName} (${deptId}): ${users.length} users`);
    }
    
    if (allUserIds.length === 0) {
      console.log(`[DEBUG] No users found in departments, cannot proceed with analysis`);
      return [];
    }
    
    logPerformance(`Fetching all department users`, startTime);
    
    // Get manager mappings and find common managers
    const { managersByDept, commonManagers } = await getCommonManagers(departmentIds, connectionIds);
    console.log(`[DEBUG] Found ${commonManagers.length} common managers across departments`);
    
    // Get the different conversation types
    console.log(`[DEBUG] Fetching different inter-department conversation types`);
    const conversationStartTime = Date.now();
    
    const conversationTypes = await Promise.all([
      // 1. DMs between members of different departments
      getCrossDepartmentDMs(connectionIds, allUserIds, departmentUsers),
      // 2. DMs with common managers
      getManagerDMs(connectionIds, allUserIds, commonManagers),
      // 3. Shared channels between departments
      getSharedChannels(connectionIds, allUserIds, departmentNames, departmentUsers)
    ]);
    
    logPerformance(`Fetching all inter-department conversation types`, conversationStartTime);
    
    // Combine and deduplicate all results
    const result = deduplicateConversations([].concat(...conversationTypes));
    console.log(`[DEBUG] Found ${result.length} total inter-department conversations`);
    
    logPerformance(`Getting all inter-department conversations`, startTime);
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to get inter-department conversations: ${error.message}`);
    return [];
  }
}

// Helper: Get manager relationships and find common managers
async function getCommonManagers(departmentIds, connectionIds) {
  const startTime = Date.now();
  console.log(`[DEBUG] Finding common managers across ${departmentIds.length} departments`);
  
  try {
    // Use a single query to get all department assignments
    const allAssignments = await prisma.departmentAssignment.findMany({
      where: { 
        department: { in: departmentIds }, 
        connectionId: { in: Array.isArray(connectionIds) ? connectionIds : [connectionIds] },
        managerId: { not: null } // Only get assignments with managers
      },
      select: {
        department: true,
        userId: true,
        managerId: true
      }
    });
    
    console.log(`[DEBUG] Found ${allAssignments.length} department assignments with managers`);
    
    // Process results in memory
    const managersByDept = {};
    const managerToDepts = {};
    
    for (const assignment of allAssignments) {
      // Skip entries without managers (though we filtered in query)
      if (!assignment.managerId) continue;
      
      // Track managers by department
      if (!managersByDept[assignment.department]) {
        managersByDept[assignment.department] = new Set();
      }
      managersByDept[assignment.department].add(assignment.managerId);
      
      // Track departments by manager
      if (!managerToDepts[assignment.managerId]) {
        managerToDepts[assignment.managerId] = new Set();
      }
      managerToDepts[assignment.managerId].add(assignment.department);
    }
    
    // Find common managers (managers who oversee multiple selected departments)
    const commonManagers = Object.entries(managerToDepts)
      .filter(([_, depts]) => depts.size > 1)
      .map(([managerId]) => managerId);
    
    console.log(`[DEBUG] Found ${commonManagers.length} common managers across departments:`);
    
    // Log more details about common managers
    if (commonManagers.length > 0) {
      for (const managerId of commonManagers) {
        const departmentsManaged = Array.from(managerToDepts[managerId]);
        console.log(`[DEBUG] Manager ${managerId} manages departments: ${departmentsManaged.join(', ')}`);
      }
    }
    
    logPerformance(`Finding common managers`, startTime);
    
    return { managersByDept, commonManagers };
  } catch (error) {
    console.error(`[ERROR] Failed to get common managers: ${error.message}`);
    return { managersByDept: {}, commonManagers: [] };
  }
}

// Helper: Get DMs between members of different departments
async function getCrossDepartmentDMs(connectionIds, allUserIds, departmentUsers) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching cross-department DMs for ${allUserIds.length} users`);
  
  if (allUserIds.length === 0) {
    console.log('[DEBUG] No users provided for cross-department DM analysis');
    return [];
  }
  
  try {
    // First, get all DMs that involve any of our tracked users
    const interDeptDMs = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds },
        messageType: 'dm',
        OR: [
          { userId: { in: allUserIds } },
          { participants: { hasSome: allUserIds } }
        ]
      },
      orderBy: { slackSentAt: 'desc' },
      take: 500 // Limit to recent conversations
    });
    
    console.log(`[DEBUG] Found ${interDeptDMs.length} initial DMs to analyze`);
    
    // Create a map of user ID to department ID for O(1) lookups
    const userDepartmentMap = {};
    for (const [deptId, users] of Object.entries(departmentUsers)) {
      for (const userId of users) {
        userDepartmentMap[userId] = deptId;
      }
    }
    
    // Filter: keep only DMs between members of DIFFERENT departments
    const filtered = interDeptDMs.filter(dm => {
      // First check if we know the sender's department
      const senderDeptId = userDepartmentMap[dm.userId];
      if (!senderDeptId) return false; // Sender not in our departments
      
      // Now check if any participant is from a DIFFERENT department
      for (const participantId of dm.participants) {
        const participantDeptId = userDepartmentMap[participantId];
        // If this participant is from a different department, this is a cross-dept conversation
        if (participantDeptId && participantDeptId !== senderDeptId) {
          // console.log(`[DEBUG] Found cross-dept DM: ${dm.id} between ${dm.userId} (${senderDeptId}) and ${participantId} (${participantDeptId})`);
          return true;
        }
      }
      
      return false; // No cross-department participants found
    });
    
    console.log(`[DEBUG] After filtering: ${filtered.length} cross-department DMs`);
    logPerformance('Fetching cross-department DMs', startTime);
    return filtered;
  } catch (error) {
    console.error(`[ERROR] Failed to get cross-department DMs: ${error.message}`);
    return [];
  }
}

// Helper: Get DMs with common managers
async function getManagerDMs(connectionIds, allUserIds, commonManagers) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching DMs involving common managers. Common managers: ${commonManagers.length}`);
  
  if (commonManagers.length === 0 || allUserIds.length === 0) {
    console.log('[DEBUG] No common managers or users to analyze');
    return [];
  }
  
  try {
    // Get DMs involving both common managers and department users
    const managerDMs = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds },
        messageType: 'dm',
        OR: [
          { 
            userId: { in: commonManagers },
            participants: { hasSome: allUserIds }
          },
          { 
            userId: { in: allUserIds },
            participants: { hasSome: commonManagers }
          }
        ]
      },
      orderBy: { slackSentAt: 'desc' },
      take: 500 // Limit to recent conversations
    });
    
    console.log(`[DEBUG] Found ${managerDMs.length} DMs involving common managers`);
    
    // Validate manager DMs - ensure they're actually between a manager and their reports
    // (Though this may be redundant since we've already filtered by common managers)
    const validManagerDMs = managerDMs.filter(dm => {
      // Check if either the sender is a common manager and recipient is a department user,
      // or recipient is a common manager and sender is a department user
      const senderIsManager = commonManagers.includes(dm.userId);
      
      // Check if any participant is a manager (when sender is a user)
      const participantIsManager = !senderIsManager && 
        dm.participants.some(p => commonManagers.includes(p));
        
      return senderIsManager || participantIsManager;
    });
    
    console.log(`[DEBUG] After validation: ${validManagerDMs.length} valid manager DMs`);
    logPerformance('Fetching manager DMs', startTime);
    return validManagerDMs;
  } catch (error) {
    console.error(`[ERROR] Failed to get manager DMs: ${error.message}`);
    return [];
  }
}

// Helper: Get shared channels between departments
async function getSharedChannels(connectionIds, allUserIds, departmentNames, departmentUsers) {
  const startTime = Date.now();
  console.log(`[DEBUG] Fetching shared channels between departments: ${departmentNames.join(', ')}`);
  
  if (departmentNames.length === 0 || allUserIds.length === 0) {
    console.log('[DEBUG] No departments or users provided for shared channel analysis');
    return [];
  }
  
  try {
    // Find all channel conversations from our department users
    const channelConversations = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds },
        messageType: 'channel',
        OR: [
          { userId: { in: allUserIds } },
          { participants: { hasSome: allUserIds } }
        ]
      },
      distinct: ['channelId', 'channelName']
    });
    
    console.log(`[DEBUG] Found ${channelConversations.length} distinct channels to analyze`);
    
    // Create a map of user ID to department ID for O(1) lookups
    const userDepartmentMap = {};
    for (const [deptId, users] of Object.entries(departmentUsers)) {
      for (const userId of users) {
        userDepartmentMap[userId] = deptId;
      }
    }
    
    // Get unique channel IDs to fetch all relevant conversations
    const channelIds = [...new Set(channelConversations.map(c => c.channelId))];
    console.log(`[DEBUG] Analyzing ${channelIds.length} unique channels`);
    
    // For each channel, get conversations to analyze department participation
    const sharedChannels = [];
    
    for (const channelId of channelIds) {
      // Get all conversations in this channel (limited to most recent)
      const conversations = await prisma.slackConversation.findMany({
        where: {
          slackConnectionId: { in: connectionIds },
          channelId,
          messageType: 'channel'
        },
        orderBy: { slackSentAt: 'desc' },
        take: 100 // Limit to recent conversations
      });
      
      // Track departments participating in this channel
      const departmentsInChannel = new Set();
      const channelName = conversations[0]?.channelName || channelId;
      
      // First check if channel name contains multiple department names (quick check)
      const nameMatches = departmentNames.filter(name => 
        channelName.toLowerCase().includes(name.toLowerCase())
      );
      
      if (nameMatches.length > 1) {
        console.log(`[DEBUG] Channel ${channelName} matched multiple department names: ${nameMatches.join(', ')}`);
        // Get all conversations in this channel
        sharedChannels.push(...conversations);
        continue; // Skip the user-based check since we already know it's shared
      }
      
      // Check if users from different departments participate in this channel
      for (const conv of conversations) {
        const senderDeptId = userDepartmentMap[conv.userId];
        if (senderDeptId) departmentsInChannel.add(senderDeptId);
        
        // Check participants mentioned
        for (const participantId of (conv.participants || [])) {
          const participantDeptId = userDepartmentMap[participantId];
          if (participantDeptId) departmentsInChannel.add(participantDeptId);
        }
        
        // If we already found users from multiple departments, this is a shared channel
        if (departmentsInChannel.size > 1) break;
      }
      
      // If channel has users from multiple departments, add it to shared channels
      if (departmentsInChannel.size > 1) {
        console.log(`[DEBUG] Channel ${channelName} has users from ${departmentsInChannel.size} departments`);
        sharedChannels.push(...conversations);
      }
    }
    
    console.log(`[DEBUG] Found ${sharedChannels.length} conversations in shared channels`);
    logPerformance('Fetching shared channels', startTime);
    return sharedChannels;
  } catch (error) {
    console.error(`[ERROR] Failed to get shared channels: ${error.message}`);
    return [];
  }
}

async function analyzeConnectionConversationsFiltered(connection, { channelIds, personId, departmentIds, dateRange, model = 'gemini' }) {
  try {
    console.log('[DEBUG] departmentIds:', departmentIds);
    
    let conversations = [];
    let analysisType = 'standard';
    
    // Determine analysis type and fetch the relevant conversations
    if (departmentIds && departmentIds.length === 1) {
      // Intra-department analysis
      analysisType = 'intra-department';
      conversations = await getIntraDepartmentConversations(connection.id, departmentIds[0]);
      console.log(`[INTRA-DEPT] Department: ${departmentIds[0]} | Messages: ${conversations.length}`);
    }
    else if (departmentIds && departmentIds.length > 1) {
      // Inter-department analysis
      analysisType = 'inter-department';
      console.log(`[INTER-DEPT] Starting analysis for departments: ${departmentIds.join(', ')}`);
      conversations = await getInterDepartmentConversations(connection, departmentIds);
      console.log(`[INTER-DEPT] Departments: ${departmentIds.join(', ')} | Messages: ${conversations.length}`);
    }
    else {
      // Standard analysis
      conversations = await getStandardConversations(connection, {
        channelIds,
        personId,
        departmentIds,
        dateRange
      });
    }
    
    // Return early if no conversations found
    if (conversations.length === 0) {
      return { 
        tasksFound: 0, 
        message: `No conversations found for ${analysisType} analysis` 
      };
    }
    
    // Run analysis and store results
    const results = await runAnalysisOnConversations(connection.id, conversations, model);
    
    return {
      tasksFound: results.length,
      message: results.length > 0 
        ? `Found ${results.length} potential automation tasks` 
        : 'No automation opportunities found in the analyzed conversations'
    };
  } catch (error) {
    console.error('Connection analysis error:', error);
    return { tasksFound: 0, error: error.message };
  }
}

// Helper to fetch standard conversations (no department analysis)
async function getStandardConversations(connection, { channelIds, personId, departmentIds, dateRange }) {
  const where = { slackConnectionId: connection.id };
  
  // Apply channel filter
  if (channelIds && channelIds.length > 0) {
    where.channelId = { in: channelIds };
  }
  
  // Apply person filter
  if (personId) {
    where.OR = [
      { userId: personId },
      { participants: { has: personId } }
    ];
  }
  
  // Apply department filter
  if (departmentIds && departmentIds.length > 0) {
    // Find all userIds assigned to these departments for this connection
    const assignments = await prisma.departmentAssignment.findMany({
      where: { connectionId: connection.id, department: { in: departmentIds } },
      select: { userId: true }
    });
    const departmentUserIds = assignments.map(a => a.userId);
    
    if (departmentUserIds.length > 0) {
      if (!where.OR) where.OR = [];
      where.OR.push({ userId: { in: departmentUserIds } });
    }
  }
  
  // Apply date filter - ADD TIME CONSTRAINT BY DEFAULT if not specified
  if (dateRange?.from) {
    where.slackSentAt = { gte: new Date(dateRange.from) };
  } else {
    // Default: limit to last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    where.slackSentAt = { gte: ninetyDaysAgo };
  }
  
  // Use paginatedQuery for all large conversation queries
  const queryFn = async (page, pageSize) => {
    return await prisma.slackConversation.findMany({
      where,
      orderBy: { slackSentAt: 'desc' },
      skip: page * pageSize,
      take: pageSize
    });
  };
  
  const conversations = await paginatedQuery(queryFn);
  
  // Log summary stats
  logConversationStats(conversations);
  
  return conversations;
}

// Helper to log conversation statistics
function logConversationStats(conversations) {
  // Group conversations by channel
  const channelStats = {};
  for (const conv of conversations) {
    const chan = conv.channelName || conv.channelId || 'DM';
    if (!channelStats[chan]) channelStats[chan] = [];
    channelStats[chan].push(conv.slackSentAt || conv.createdAt);
  }
  
  // Log summary for each channel
  for (const [chan, dates] of Object.entries(channelStats)) {
    dates.sort();
    console.log(
      `[ANALYSIS] Channel: ${chan} | Messages: ${dates.length} | Range: ${dates[0]?.toISOString()} - ${dates[dates.length-1]?.toISOString()}`
    );
  }
}

// Efficient conversation deduplication using Set operations
function deduplicateConversations(conversations) {
  const startTime = Date.now();
  console.log(`[DEBUG] Deduplicating ${conversations.length} conversations`);
  
  if (!conversations || conversations.length === 0) {
    console.log('[DEBUG] No conversations to deduplicate');
    return [];
  }
  
  try {
    // Use a Set for O(1) lookups by conversation ID
    const uniqueIds = new Set();
    const uniqueConversations = [];
    
    for (const conv of conversations) {
      if (!conv.id) {
        console.warn('[WARN] Found conversation without ID during deduplication');
        continue;
      }
      
      if (!uniqueIds.has(conv.id)) {
        uniqueIds.add(conv.id);
        uniqueConversations.push(conv);
      }
    }
    
    console.log(`[DEBUG] After deduplication: ${uniqueConversations.length} conversations`);
    logPerformance('Conversation deduplication', startTime);
    
    return uniqueConversations;
  } catch (error) {
    console.error(`[ERROR] Error during conversation deduplication: ${error.message}`);
    return Array.isArray(conversations) ? conversations : [];
  }
}

// Helper to run analysis on conversations and store results
async function runAnalysisOnConversations(connectionId, conversations, model) {
  // Format conversations for analysis
  const conversationText = conversations.map(conv => ({
    channel: conv.channelName || 'DM',
    message: conv.messageText,
    participants: conv.participants,
    timestamp: conv.createdAt
  }));
  
  // Run analysis with selected model
  const analysis = model === 'openai'
    ? await analyzeWithOpenAI(conversationText)
    : await analyzeWithGemini(conversationText);
  
  // Store results in database
  return await storeAnalysisResults(connectionId, conversations, analysis);
}

// Create shared prompt builder function
function buildAnalysisPrompt(conversations) {
  return `Role & Objective
You are an expert Workflow-Automation Analyst hired to streamline our Account Management team's day-to-day operations. Your job is to mine through large volumes of raw Slack threads and meeting transcripts (≈100–200 pages of unstructured text) and uncover the tasks that are most worth automating.

Input
Data: Raw text files containing Slack conversations and call transcripts for the Account Management team.
Scope: Anything in the dataset that shows how individual account managers, sub-teams, or the whole team repeatedly perform work.

What to Deliver
Return a JSON array of objects. Each object should represent one automation opportunity and include the following fields with exactly these labels:
  •	Title: Short, clear name for the task.
	•	Task: Plain-English description of the repetitive action.
	•	Current Manual Steps: Brief outline of how humans do it today.
	•	Frequency Score: Integer from 1–5 (1 = rare, 5 = constant/daily).
	•	Automation Ease Score: Integer from 1–5 (1 = very hard, 5 = trivial).
	•	Priority Score: Frequency × Ease (integer).
	•	Suggested Automation Approach: Concrete idea—e.g., "Zapier webhook → Python serverless function → CRM API."
	•	Estimated Time Saved / Occurrence: Rough minutes saved each time the automation runs.
	•	Rationale: 2–3 sentences explaining why you assigned those scores and chose that approach.
	•	Confidence: A number from 0 to 1 representing how confident you are in this automation opportunity (1 = extremely confident, 0 = not confident).

Ranking Rules:
Sort by Priority Score (descending).
If two tasks tie, list the one with the higher Frequency Score first.

Tools:
You may assume access to Zapier, Pipedream, Python/Node.js functions, and modern SaaS APIs.

Format Instructions:
Only return a valid JSON array of objects.
Do not include raw transcript data, markdown, commentary, or summary.
Each object must be concise (under 200 words).

Data:
${conversations.map(conv => conv.messageText || conv.message || '').join('\n')}`;
}

// Extract response parsing to a common function
function parseModelResponse(text) {
  if (text.startsWith('```json')) {
    text = text.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (text.startsWith('```')) {
    text = text.replace(/^```/, '').replace(/```$/, '').trim();
  }
  
  const jsonMatch = text.match(/(\[.*\]|\{.*\})/s);
  if (jsonMatch) {
    text = jsonMatch[0];
  }
  
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('Failed to parse model response:', error);
    return [];
  }
}

async function analyzeWithOpenAI(conversations) {
  const prompt = buildAnalysisPrompt(conversations);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3
    });

    const text = response.choices[0].message.content.trim();
    return parseModelResponse(text);
  } catch (error) {
    console.error('OpenAI analysis error:', error);
    return [];
  }
}

async function analyzeWithGemini(conversations) {
  const prompt = buildAnalysisPrompt(conversations);
  
  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt
    });
    
    let text = '';
    if (response && response.candidates && response.candidates[0] && 
        response.candidates[0].content && response.candidates[0].content.parts && 
        response.candidates[0].content.parts[0]) {
      text = response.candidates[0].content.parts[0].text.trim();
    } else if (response.text) {
      text = response.text.trim();
    } else {
      console.error('Gemini response format unexpected:', response);
      return [];
    }
    
    return parseModelResponse(text);
  } catch (error) {
    console.error('Gemini analysis error:', error);
    return [];
  }
}

async function storeAnalysisResults(connectionId, conversations, analysis) {
  const tasks = [];
  
  for (const task of analysis) {
    try {
      // Normalize task data using helper function
      const normalizedTask = normalizeTaskData(task);
      
      // Find a relevant conversation
      const relevantConversation = findRelevantConversation(conversations, normalizedTask.title);
      
      if (!normalizedTask.title && !normalizedTask.taskDescription) {
        continue; // Skip tasks without minimum required data
      }
      
      // Create task in database
      const createdTask = await createTaskInDatabase(relevantConversation.id, normalizedTask);
      tasks.push(createdTask);
    } catch (error) {
      console.error('Failed to store task:', error);
    }
  }
  
  return tasks;
}

// Helper function to normalize task data from different formats
function normalizeTaskData(task) {
  return {
    title: task['Title'] || task['Task Name'] || task['Task'] || '',
    taskDescription: task['Task'] || task['Task Description'] || '',
    currentManualSteps: task['Current Manual Steps'] || '',
    frequencyScore: parseInt(task['Frequency Score']) || 
                   (typeof task['Frequency'] === 'number' ? task['Frequency'] : undefined) || 0,
    automationEaseScore: parseInt(task['Automation Ease Score']) || 
                        (typeof task['Automation Ease'] === 'number' ? task['Automation Ease'] : undefined) || 0,
    priorityScore: parseInt(task['Priority Score']) || 0,
    suggestedAutomationApproach: task['Suggested Automation Approach'] || '',
    estimatedTimeSaved: normalizeTimeSaved(task),
    rationale: task['Rationale'] || '',
    frequency: task['Frequency'] || '', // Fixed: was incorrectly using taskData.frequency
    difficulty: task['Difficulty'] || '',
    estimatedRoi: task['Estimated ROI'] || '',
    suggestedTools: normalizeSuggestedTools(task),
    confidence: normalizeConfidence(task)
  };
}

// Helper to normalize time saved
function normalizeTimeSaved(task) {
  const estimatedTimeSavedRaw = task['Estimated Time Saved / Occurrence'] || 
                               task['Estimated Time Saved'] || '';
  return typeof estimatedTimeSavedRaw === 'string' ? 
         estimatedTimeSavedRaw : String(estimatedTimeSavedRaw);
}

// Helper to normalize suggested tools
function normalizeSuggestedTools(task) {
  if (Array.isArray(task['Suggested Tools'])) {
    return task['Suggested Tools'];
  }
  
  if (typeof task['Suggested Tools'] === 'string') {
    return task['Suggested Tools'].split(',').map(t => t.trim()).filter(Boolean);
  }
  
  return [];
}

// Helper to normalize confidence score
function normalizeConfidence(task) {
  if (typeof task['Confidence'] === 'number') {
    return task['Confidence'];
  }
  
  if (typeof task['Confidence'] === 'string') {
    const match = task['Confidence'].match(/([0-9.]+)/);
    return match ? parseFloat(match[1]) : 0.5;
  }
  
  return 0.5;
}

// Helper to find a relevant conversation for a task
function findRelevantConversation(conversations, title) {
  // Try to find a conversation that mentions the first word of the task title
  const matchingConversation = conversations.find(conv =>
    typeof conv.messageText === 'string' &&
    title && conv.messageText.toLowerCase().includes(title.toLowerCase().split(' ')[0])
  );
  
  // Fall back to the first conversation if no match found
  return matchingConversation || conversations[0];
}

// Helper to create a task in the database
async function createTaskInDatabase(conversationId, taskData) {
  return await prisma.automationTask.create({
    data: {
      slackConversationId: conversationId,
      title: taskData.title,
      taskDescription: taskData.taskDescription,
      currentManualSteps: taskData.currentManualSteps,
      frequencyScore: taskData.frequencyScore,
      automationEaseScore: taskData.automationEaseScore,
      priorityScore: taskData.priorityScore,
      suggestedAutomationApproach: taskData.suggestedAutomationApproach,
      estimatedTimeSaved: taskData.estimatedTimeSaved,
      rationale: taskData.rationale,
      frequency: taskData.frequency,
      difficulty: taskData.difficulty,
      estimatedRoi: taskData.estimatedRoi,
      suggestedTools: taskData.suggestedTools,
      confidence: taskData.confidence,
      status: 'pending'
    }
  });
}

module.exports = {
  analyzeConnectionConversationsFiltered,
  analyzeWithOpenAI,
  analyzeWithGemini,
  storeAnalysisResults
}; 