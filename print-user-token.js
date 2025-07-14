// Script to print user token from a Slack connection and validate it
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function validateToken(token) {
  try {
    // Check token identity
    const authResponse = await axios.get('https://slack.com/api/auth.test', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!authResponse.data.ok) {
      return {
        valid: false,
        error: authResponse.data.error
      };
    }
    
    // Check token scopes
    const scopesResponse = await axios.get('https://slack.com/api/apps.auth.test', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (scopesResponse.data.ok) {
      return {
        valid: true,
        identity: authResponse.data,
        scopes: scopesResponse.data.scopes || []
      };
    } else {
      return {
        valid: true,
        identity: authResponse.data,
        scopes: [],
        scopesError: scopesResponse.data.error
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

async function printUserToken() {
  try {
    // Get all connections
    const connections = await prisma.slackConnection.findMany({
      select: {
        id: true,
        slackTeamName: true,
        slackUserId: true,
        userToken: true,
        accessToken: true
      }
    });

    console.log(`Found ${connections.length} Slack connections\n`);

    if (connections.length === 0) {
      console.log('No connections found in the database');
      return;
    }

    // Print each connection's user token
    for (const connection of connections) {
      console.log(`Connection: ${connection.slackTeamName || 'Unknown Team'} (User ID: ${connection.slackUserId || 'Unknown'})`);
      console.log(`ID: ${connection.id}`);
      
      // User token info
      if (connection.userToken) {
        console.log(`User Token: ${connection.userToken}`);
        
        // Validate user token
        console.log('Validating user token...');
        const userTokenValidation = await validateToken(connection.userToken);
        
        if (userTokenValidation.valid) {
          console.log(`✅ User token is valid for: ${userTokenValidation.identity.user} (${userTokenValidation.identity.user_id})`);
          console.log(`Team: ${userTokenValidation.identity.team} (${userTokenValidation.identity.team_id})`);
          
          if (userTokenValidation.scopes && userTokenValidation.scopes.length > 0) {
            console.log(`Scopes: ${userTokenValidation.scopes.join(', ')}`);
            
            // Check for important scopes
            const hasChannelsHistory = userTokenValidation.scopes.includes('channels:history');
            const hasGroupsHistory = userTokenValidation.scopes.includes('groups:history');
            const hasImHistory = userTokenValidation.scopes.includes('im:history');
            
            console.log(`Has channels:history: ${hasChannelsHistory ? '✅' : '❌'}`);
            console.log(`Has groups:history: ${hasGroupsHistory ? '✅' : '❌'}`);
            console.log(`Has im:history: ${hasImHistory ? '✅' : '❌'}`);
          } else if (userTokenValidation.scopesError) {
            console.log(`⚠️ Could not check scopes: ${userTokenValidation.scopesError}`);
          }
        } else {
          console.log(`❌ User token is invalid: ${userTokenValidation.error}`);
        }
      } else {
        console.log('User Token: Not available');
      }
      
      // Bot token info (summary)
      if (connection.accessToken) {
        console.log(`\nBot Token: ${connection.accessToken.substring(0, 10)}...`);
        
        // Validate bot token (basic)
        console.log('Validating bot token...');
        const botTokenValidation = await validateToken(connection.accessToken);
        
        if (botTokenValidation.valid) {
          console.log(`✅ Bot token is valid`);
          if (botTokenValidation.identity.bot_id) {
            console.log(`Bot ID: ${botTokenValidation.identity.bot_id}`);
          }
        } else {
          console.log(`❌ Bot token is invalid: ${botTokenValidation.error}`);
        }
      } else {
        console.log('\nBot Token: Not available');
      }
      
      console.log('-----------------------------------');
    }
  } catch (error) {
    console.error('Error fetching user tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the function
printUserToken(); 