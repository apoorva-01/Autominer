import { axios } from "@pipedream/platform";

export default defineComponent({
  props: {
    slack: {
      type: "app",
      app: "slack",
      description: "Slack workspace to fetch conversations from",
    },
    google_docs: {
      type: "app",
      app: "google_docs",
      description: "Google Docs for creating documents",
    },
    google_drive: {
      type: "app",
      app: "google_drive",
      description: "Google Drive for organizing documents",
    },
    person_name: {
      type: "string",
      label: "Person Name",
      description:
        "Name of the person this export is for (e.g., 'Andrew', 'April', 'Maria', 'Jeremy')",
    },
    target_users: {
      type: "string[]",
      label: "Target Users for DMs",
      description:
        "Users to fetch DMs with. Format: 'Name' or 'Name:UserID' (e.g., 'Kevin:U1234567890' or just 'Kevin')",
     default: ["Kevin:U05UYN1987Q", "Jeremy:U08B4HP73V3", "Moemen:U05AL5LLD2Q", "Paul:U03BMKZJ5DM", "Benedict:U0443Q7SM62", "Maria:U06234H0YCD", "April:UHJLGGL5B"]
    },
    target_channels: {
      type: "string[]",
      label: "Target Channels",
      description:
        "Channel names to fetch. Format: 'channel-name' or 'channel-name:CHANNEL_ID' (e.g., 'team-operations:C1234567890' or just 'general')",
      default: [
        "department-heads:C04129UKKLN","account-management:C03D131T9JP","salesteam:C052KVCMM6Y"
      ],
    },
    drive_folder_name: {
      type: "string",
      label: "Google Drive Folder Name",
      description: "Name of the folder to create/use for storing the documents",
      default: "Personal Tobi",
    },
    create_subfolders: {
      type: "boolean",
      label: "Create Subfolders",
      description: "Create separate subfolders for DMs and Channels",
      default: true,
    },
    include_archived: {
      type: "boolean",
      label: "Include Archived Channels",
      description: "Whether to include archived channels in the search",
      default: true,
    },
  },

  async run({ steps, $ }) {
    const results = {
      successful_exports: [],
      failed_exports: [],
      skipped_exports: [],
      total_messages: 0,
      total_documents: 0,
    };

    // Helper function to create/find Google Drive folder structure
    const setupFolder = async () => {
      try {
        console.log(
          `Setting up Google Drive folder: ${this.drive_folder_name}`
        );

        // Create or find main folder
        const folderSearch = await axios($, {
          url: "https://www.googleapis.com/drive/v3/files",
          headers: {
            Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
          },
          params: {
            q: `name='${this.drive_folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: "files(id, name)",
          },
        });

        let mainFolderId;
        if (folderSearch.files && folderSearch.files.length > 0) {
          console.log(`Found existing main folder`);
          mainFolderId = folderSearch.files[0].id;
        } else {
          const folderCreate = await axios($, {
            method: "POST",
            url: "https://www.googleapis.com/drive/v3/files",
            headers: {
              Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
              "Content-Type": "application/json",
            },
            data: {
              name: this.drive_folder_name,
              mimeType: "application/vnd.google-apps.folder",
            },
          });

          console.log(`Created new main folder`);
          mainFolderId = folderCreate.id;
        }

        // Create subfolders if enabled
        const folders = { main: mainFolderId };

        if (this.create_subfolders) {
          console.log("Setting up subfolders for DMs and Channels...");

          // Find or create Old_DM_Conversations subfolder
          const dmFolderSearch = await axios($, {
            url: "https://www.googleapis.com/drive/v3/files",
            headers: {
              Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
            },
            params: {
              q: `name='Old_DM_Conversations' and '${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
              fields: "files(id, name)",
            },
          });

          let dmFolderId;
          if (dmFolderSearch.files && dmFolderSearch.files.length > 0) {
            console.log("Found existing Old_DM_Conversations subfolder");
            dmFolderId = dmFolderSearch.files[0].id;
          } else {
            const dmFolderCreate = await axios($, {
              method: "POST",
              url: "https://www.googleapis.com/drive/v3/files",
              headers: {
                Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
                "Content-Type": "application/json",
              },
              data: {
                name: "Old_DM_Conversations",
                mimeType: "application/vnd.google-apps.folder",
                parents: [mainFolderId],
              },
            });
            console.log("Created new Old_DM_Conversations subfolder");
            dmFolderId = dmFolderCreate.id;
          }

          // Find or create Old_Channel_Conversations subfolder
          const channelFolderSearch = await axios($, {
            url: "https://www.googleapis.com/drive/v3/files",
            headers: {
              Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
            },
            params: {
              q: `name='Old_Channel_Conversations' and '${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
              fields: "files(id, name)",
            },
          });

          let channelFolderId;
          if (
            channelFolderSearch.files &&
            channelFolderSearch.files.length > 0
          ) {
            console.log("Found existing Old_Channel_Conversations subfolder");
            channelFolderId = channelFolderSearch.files[0].id;
          } else {
            const channelFolderCreate = await axios($, {
              method: "POST",
              url: "https://www.googleapis.com/drive/v3/files",
              headers: {
                Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
                "Content-Type": "application/json",
              },
              data: {
                name: "Old_Channel_Conversations",
                mimeType: "application/vnd.google-apps.folder",
                parents: [mainFolderId],
              },
            });
            console.log("Created new Old_Channel_Conversations subfolder");
            channelFolderId = channelFolderCreate.id;
          }

          folders.dm = dmFolderId;
          folders.channel = channelFolderId;

          console.log("✅ Subfolders ready for Old DMs and Old Channels");
        }

        return folders;
      } catch (error) {
        console.error("❌ Error setting up folder:", error);
        throw error;
      }
    };

    // Helper function to resolve users (by ID or name lookup)
    const resolveUsers = async () => {
      try {
        console.log("Resolving target users...");

        const resolvedUsers = {};
        const usersNeedingLookup = [];

        // Parse user entries and separate those with IDs vs those needing lookup
        for (const userEntry of this.target_users) {
          const parts = userEntry.split(":");
          const userName = parts[0].trim();
          const userId = parts.length > 1 ? parts[1].trim() : "";

          if (userId && userId !== "") {
            console.log(`Using provided user ID for ${userName}: ${userId}`);
            resolvedUsers[userName] = {
              id: userId,
              display_name: userName, // Will be updated with real display name later
              source: "provided_id",
            };
          } else {
            usersNeedingLookup.push({ name: userName });
          }
        }

        // If we have users that need name-based lookup, fetch the users list
        if (usersNeedingLookup.length > 0) {
          console.log(
            `Looking up ${usersNeedingLookup.length} users by name...`
          );

          const usersResponse = await axios($, {
            url: "https://slack.com/api/users.list",
            headers: {
              Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
            },
          });

          if (!usersResponse.ok) {
            throw new Error(`Failed to fetch users: ${usersResponse.error}`);
          }

          // Create name lookup map
          const userNameMap = {};
          usersResponse.members.forEach((user) => {
            if (!user.deleted && !user.is_bot) {
              const names = [
                user.name,
                user.real_name,
                user.profile?.display_name,
                user.profile?.first_name,
              ].filter(Boolean);

              names.forEach((name) => {
                if (name) {
                  userNameMap[name.toLowerCase()] = {
                    id: user.id,
                    display_name:
                      user.profile?.display_name || user.real_name || user.name,
                  };
                }
              });
            }
          });

          // Resolve users by name lookup
          for (const targetUser of usersNeedingLookup) {
            const userInfo = userNameMap[targetUser.name.toLowerCase()];
            if (userInfo) {
              console.log(
                `Found user by name lookup: ${targetUser.name} -> ${userInfo.id}`
              );
              resolvedUsers[targetUser.name] = {
                id: userInfo.id,
                display_name: userInfo.display_name,
                source: "name_lookup",
              };
            } else {
              console.warn(`⚠️ User not found by name: ${targetUser.name}`);
            }
          }
        }

        // For users with provided IDs, get their actual display names
        for (const [userName, userInfo] of Object.entries(resolvedUsers)) {
          if (userInfo.source === "provided_id") {
            try {
              const userDetails = await axios($, {
                url: "https://slack.com/api/users.info",
                headers: {
                  Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                },
                params: {
                  user: userInfo.id,
                },
              });

              if (userDetails.ok && userDetails.user) {
                resolvedUsers[userName].display_name =
                  userDetails.user.profile?.display_name ||
                  userDetails.user.real_name ||
                  userDetails.user.name;
                console.log(
                  `Updated display name for ${userName}: ${resolvedUsers[userName].display_name}`
                );
              }
            } catch (error) {
              console.warn(
                `⚠️ Could not get display name for user ID ${userInfo.id}:`,
                error
              );
            }
          }
        }

        console.log(
          `Resolved ${Object.keys(resolvedUsers).length} out of ${
            this.target_users.length
          } target users`
        );
        return resolvedUsers;
      } catch (error) {
        console.error("❌ Error resolving users:", error);
        throw error;
      }
    };

    // Helper function to find channels
    const findChannels = async () => {
      try {
        console.log("Finding target channels...");
        console.log(`🔍 Searching for: ${this.target_channels.join(", ")}`);
        console.log(`📋 Include archived: ${this.include_archived}`);

        const channelsResponse = await axios($, {
          url: "https://slack.com/api/conversations.list",
          headers: {
            Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
          },
          params: {
            types: "public_channel,private_channel",
            exclude_archived: !this.include_archived,
            limit: 1000,
          },
        });

        if (!channelsResponse.ok) {
          console.error(
            `❌ Failed to fetch channels: ${channelsResponse.error}`
          );
          throw new Error(
            `Failed to fetch channels: ${channelsResponse.error}`
          );
        }

        console.log(
          `📊 Bot can see ${channelsResponse.channels.length} total channels`
        );

        // Log some channel examples for debugging
        const exampleChannels = channelsResponse.channels
          .slice(0, 5)
          .map(
            (ch) =>
              `${ch.name} (${ch.is_private ? "Private" : "Public"}${
                ch.is_archived ? ", Archived" : ""
              })`
          );
        console.log(
          `📝 Example channels bot can see: ${exampleChannels.join(", ")}`
        );

        // Help find channel IDs for missing channels
        console.log(`\n🔍 CHANNEL ID HELPER:`);
        console.log(`Target channels: ${JSON.stringify(this.target_channels)}`);
        const targetChannelNames = this.target_channels.map((entry) =>
          entry.split(":")[0].trim()
        );
        console.log(
          `Parsed channel names: ${JSON.stringify(targetChannelNames)}`
        );

        // Look for exact and partial matches
        for (const targetName of targetChannelNames) {
          console.log(`\n🔍 Searching for: "${targetName}"`);

          // Exact match
          const exactMatch = channelsResponse.channels.find(
            (ch) => ch.name.toLowerCase() === targetName.toLowerCase()
          );
          if (exactMatch) {
            console.log(
              `✅ EXACT: "${targetName}" → "${exactMatch.name}" (ID: ${exactMatch.id})`
            );
            continue;
          }

          // Partial matches
          const partialMatches = channelsResponse.channels
            .filter(
              (ch) =>
                ch.name.toLowerCase().includes(targetName.toLowerCase()) ||
                targetName.toLowerCase().includes(ch.name.toLowerCase())
            )
            .slice(0, 5); // Limit to 5 results

          if (partialMatches.length > 0) {
            console.log(`🔍 SIMILAR channels for "${targetName}":`);
            partialMatches.forEach((ch) => {
              console.log(
                `   → "${ch.name}" (ID: ${ch.id}) ${
                  ch.is_private ? "[Private]" : "[Public]"
                } ${ch.is_archived ? "[Archived]" : "[Active]"}`
              );
            });
          } else {
            console.log(`❌ NO MATCHES found for "${targetName}"`);
          }
        }

        console.log(`\n`);

        // Check if bot has the right scopes
        const authTest = await axios($, {
          url: "https://slack.com/api/auth.test",
          headers: {
            Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
          },
        });

        if (authTest.ok) {
          console.log(`🤖 Bot info: ${authTest.user} in team ${authTest.team}`);
        }

        const channelMap = {};
        const foundChannels = new Set();

        // Process each target channel - PRIORITIZE CHANNEL ID FIRST, then name lookup
        for (const targetChannelEntry of this.target_channels) {
          const parts = targetChannelEntry.split(":");
          const channelName = parts[0].trim();
          const channelId = parts.length > 1 ? parts[1].trim() : null;

          let channelFound = false;

          // STEP 1: Try Channel ID first (most reliable)
          if (channelId) {
            console.log(
              `🆔 PRIORITY: Using Channel ID for "${channelName}": ${channelId}`
            );
            try {
              // Try multiple API methods for better success rate
              let channelInfo = null;

              // Method 1: conversations.info (standard)
              try {
                channelInfo = await axios($, {
                  url: "https://slack.com/api/conversations.info",
                  headers: {
                    Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                  },
                  params: {
                    channel: channelId,
                  },
                });
                console.log(
                  `   → conversations.info: ${
                    channelInfo.ok ? "SUCCESS" : channelInfo.error
                  }`
                );
              } catch (error) {
                console.log(
                  `   → conversations.info: ERROR - ${error.message}`
                );
              }

              // Method 2: If first method fails, try channels.info (for public channels)
              if (!channelInfo || !channelInfo.ok) {
                try {
                  console.log(`   → Trying channels.info as fallback...`);
                  const publicChannelInfo = await axios($, {
                    url: "https://slack.com/api/channels.info",
                    headers: {
                      Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                    },
                    params: {
                      channel: channelId,
                    },
                  });
                  if (publicChannelInfo.ok) {
                    channelInfo = publicChannelInfo;
                    console.log(`   → channels.info: SUCCESS`);
                  } else {
                    console.log(
                      `   → channels.info: ${publicChannelInfo.error}`
                    );
                  }
                } catch (error) {
                  console.log(`   → channels.info: ERROR - ${error.message}`);
                }
              }

              // Method 3: Try groups.info (for private channels)
              if (!channelInfo || !channelInfo.ok) {
                try {
                  console.log(`   → Trying groups.info as fallback...`);
                  const privateChannelInfo = await axios($, {
                    url: "https://slack.com/api/groups.info",
                    headers: {
                      Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                    },
                    params: {
                      channel: channelId,
                    },
                  });
                  if (privateChannelInfo.ok) {
                    channelInfo = privateChannelInfo;
                    console.log(`   → groups.info: SUCCESS`);
                  } else {
                    console.log(
                      `   → groups.info: ${privateChannelInfo.error}`
                    );
                  }
                } catch (error) {
                  console.log(`   → groups.info: ERROR - ${error.message}`);
                }
              }

              if (channelInfo.ok && channelInfo.channel) {
                channelMap[channelName] = {
                  channel_id: channelInfo.channel.id,
                  name: channelInfo.channel.name,
                  is_archived: channelInfo.channel.is_archived,
                  is_private: channelInfo.channel.is_private,
                };
                foundChannels.add(channelName);
                console.log(
                  `✅ SUCCESS via Channel ID: "${channelName}" → "${
                    channelInfo.channel.name
                  }" (${
                    channelInfo.channel.is_archived ? "Archived" : "Active"
                  }, ${channelInfo.channel.is_private ? "Private" : "Public"})`
                );
                channelFound = true;
              } else {
                console.log(
                  `❌ Channel ID failed for "${channelName}": ${channelInfo.error}`
                );
                if (channelInfo.error === "channel_not_found") {
                  console.log(
                    `   → Channel ID ${channelId} doesn't exist or bot can't access it`
                  );
                } else if (channelInfo.error === "not_in_channel") {
                  console.log(
                    `   → Bot is not a member of channel ${channelId} (might be private)`
                  );
                } else if (channelInfo.error === "missing_scope") {
                  console.log(
                    `   → Bot lacks permissions for channel ${channelId}`
                  );
                }
              }
            } catch (error) {
              console.log(
                `❌ Error with Channel ID ${channelId}: ${error.message}`
              );
            }
          }

          // STEP 2: If Channel ID failed or not provided, try name lookup
          if (!channelFound) {
            console.log(`🔤 FALLBACK: Searching by name for "${channelName}"`);
            const targetChannelLower = channelName.toLowerCase();
            const foundChannel = channelsResponse.channels.find(
              (channel) => channel.name.toLowerCase() === targetChannelLower
            );

            if (foundChannel) {
              channelMap[channelName] = {
                channel_id: foundChannel.id,
                name: foundChannel.name,
                is_archived: foundChannel.is_archived,
                is_private: foundChannel.is_private,
              };
              foundChannels.add(channelName);
              console.log(
                `✅ SUCCESS via Name: "${channelName}" → "${
                  foundChannel.name
                }" (ID: ${foundChannel.id}) (${
                  foundChannel.is_archived ? "Archived" : "Active"
                }, ${foundChannel.is_private ? "Private" : "Public"})`
              );
              channelFound = true;
            } else {
              console.log(
                `❌ Name lookup failed for "${channelName}" - not found in visible channels`
              );
            }
          }

          if (!channelFound) {
            console.log(
              `💔 TOTAL FAILURE: Could not find "${channelName}" via ID or name`
            );
          }
        }

        // Log missing channels and try to access them directly
        const missingChannelEntries = this.target_channels.filter((entry) => {
          const channelName = entry.split(":")[0].trim();
          return !foundChannels.has(channelName);
        });

        if (missingChannelEntries.length > 0) {
          const missingChannelNames = missingChannelEntries.map((entry) =>
            entry.split(":")[0].trim()
          );
          console.log(`❌ Missing channels: ${missingChannelNames.join(", ")}`);

          // Try to access missing channels directly to get specific error (only for name-only entries)
          for (const missingChannelEntry of missingChannelEntries) {
            const parts = missingChannelEntry.split(":");
            const channelName = parts[0].trim();
            const channelId = parts.length > 1 ? parts[1].trim() : null;

            // Only try direct access for name-only entries (ID entries were already tried above)
            if (!channelId) {
              try {
                console.log(`🔍 Trying direct access to #${channelName}...`);
                const channelInfo = await axios($, {
                  url: "https://slack.com/api/conversations.info",
                  headers: {
                    Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                  },
                  params: {
                    channel: channelName,
                  },
                });

                if (!channelInfo.ok) {
                  console.log(
                    `❌ Direct access failed for #${channelName}: ${channelInfo.error}`
                  );
                  if (channelInfo.error === "channel_not_found") {
                    console.log(
                      `   → Channel #${channelName} doesn't exist or bot can't see it`
                    );
                    console.log(
                      `   💡 Try using format: "${channelName}:CHANNEL_ID" if you know the channel ID`
                    );
                  } else if (channelInfo.error === "not_in_channel") {
                    console.log(
                      `   → Bot is not a member of #${channelName} (private channel?)`
                    );
                    console.log(
                      `   💡 Try using format: "${channelName}:CHANNEL_ID" to bypass this`
                    );
                  } else if (channelInfo.error === "missing_scope") {
                    console.log(
                      `   → Bot lacks required permissions for #${channelName}`
                    );
                  }
                } else {
                  console.log(
                    `✅ Channel #${channelName} exists but wasn't in the list (private/archived?)`
                  );
                }
              } catch (error) {
                console.log(
                  `❌ Error checking #${channelName}: ${error.message}`
                );
              }
            }
          }

          // Suggest similar channel names
          const allChannelNames = channelsResponse.channels.map(
            (ch) => ch.name
          );
          missingChannelNames.forEach((missingChannelName) => {
            const similarChannels = allChannelNames
              .filter(
                (name) =>
                  name.includes(missingChannelName) ||
                  missingChannelName.includes(name) ||
                  name
                    .toLowerCase()
                    .includes(missingChannelName.toLowerCase()) ||
                  missingChannelName.toLowerCase().includes(name.toLowerCase())
              )
              .slice(0, 3);

            if (similarChannels.length > 0) {
              console.log(
                `💡 Similar to "${missingChannelName}": ${similarChannels.join(
                  ", "
                )}`
              );
            }
          });
        }

        console.log(
          `📊 Found ${Object.keys(channelMap).length} out of ${
            this.target_channels.length
          } target channels`
        );
        return channelMap;
      } catch (error) {
        console.error("❌ Error finding channels:", error);
        throw error;
      }
    };

    // Helper function to fetch all messages from a conversation with multiple API fallbacks
    const fetchAllMessages = async (
      channelId,
      conversationName,
      channelInfo = null
    ) => {
      console.log(`Fetching all messages for: ${conversationName}`);
      let allMessages = [];
      let hasMore = true;
      let cursor = null;

      while (hasMore) {
        try {
          const params = {
            channel: channelId,
            limit: 1000,
            oldest: "0", // From the beginning
          };

          if (cursor) {
            params.cursor = cursor;
          }

          let response = null;

          // Method 1: conversations.history (modern API)
          try {
            response = await axios($, {
              url: "https://slack.com/api/conversations.history",
              headers: {
                Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
              },
              params: params,
            });

            if (response.ok) {
              console.log(
                `   → conversations.history: SUCCESS (${
                  response.messages?.length || 0
                } messages)`
              );
            } else {
              console.log(`   → conversations.history: ${response.error}`);
            }
          } catch (error) {
            console.log(`   → conversations.history: ERROR - ${error.message}`);
          }

          // Method 2: channels.history (for public channels)
          if (!response || !response.ok) {
            try {
              console.log(`   → Trying channels.history as fallback...`);
              response = await axios($, {
                url: "https://slack.com/api/channels.history",
                headers: {
                  Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                },
                params: params,
              });

              if (response.ok) {
                console.log(
                  `   → channels.history: SUCCESS (${
                    response.messages?.length || 0
                  } messages)`
                );
              } else {
                console.log(`   → channels.history: ${response.error}`);
              }
            } catch (error) {
              console.log(`   → channels.history: ERROR - ${error.message}`);
            }
          }

          // Method 3: groups.history (for private channels)
          if (!response || !response.ok) {
            try {
              console.log(`   → Trying groups.history as fallback...`);
              response = await axios($, {
                url: "https://slack.com/api/groups.history",
                headers: {
                  Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
                },
                params: params,
              });

              if (response.ok) {
                console.log(
                  `   → groups.history: SUCCESS (${
                    response.messages?.length || 0
                  } messages)`
                );
              } else {
                console.log(`   → groups.history: ${response.error}`);
              }
            } catch (error) {
              console.log(`   → groups.history: ERROR - ${error.message}`);
            }
          }

          if (!response || !response.ok) {
            console.error(
              `❌ All API methods failed for ${conversationName}:`,
              response?.error || "No response"
            );
            break;
          }

          const messages = response.messages || [];
          allMessages = allMessages.concat(messages);

          cursor = response.response_metadata?.next_cursor;
          hasMore = !!cursor;

          console.log(
            `Fetched ${messages.length} messages (total: ${allMessages.length})`
          );

          // Rate limiting delay
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.error(
            `❌ Error fetching messages for ${conversationName}:`,
            error
          );
          break;
        }
      }

      console.log(
        `Total messages fetched for ${conversationName}: ${allMessages.length}`
      );
      return allMessages.reverse(); // Chronological order
    };

    // Helper function to retry API calls with exponential backoff
    const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          const isRetryable =
            error.response?.status === 503 ||
            error.response?.status === 429 ||
            error.response?.status === 500;

          if (attempt === maxRetries || !isRetryable) {
            throw error;
          }

          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(
            `⚠️ API error (${error.response?.status}), retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    };

    // Helper function to create multiple documents for extremely large content
    const createMultipleDocuments = async (title, content, folderId) => {
      console.log(`🔄 Starting multi-document creation for: ${title}`);
      const maxDocumentSize = 800 * 1024; // 800KB per document (much safer limit)
      const lines = content.split("\n");

      // Find header end
      let headerEndIndex = 0;
      let foundSeparator = false;
      let headerContent = "";

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("=".repeat(10))) {
          foundSeparator = true;
        }

        headerContent += lines[i] + "\n";

        if (
          foundSeparator &&
          i + 1 < lines.length &&
          lines[i + 1].trim() === ""
        ) {
          headerContent += "\n";
          headerEndIndex = i + 2;
          break;
        }
      }

      const messageLines = lines.slice(headerEndIndex);
      const documents = [];
      let currentDocContent = "";
      let currentDocLines = [];
      let docNumber = 1;

      for (let i = 0; i < messageLines.length; i++) {
        const line = messageLines[i];
        const potentialContent = currentDocContent + line + "\n";

        // Check if adding this line would exceed document size
        if (
          new TextEncoder().encode(headerContent + potentialContent).length >
            maxDocumentSize &&
          currentDocContent.length > 0
        ) {
          // Create document for current content with _Part format
          const docTitle = `${title}_Part${docNumber}`;
          const fullContent = headerContent + currentDocContent;

          console.log(
            `Creating document part ${docNumber} (${Math.round(
              new TextEncoder().encode(fullContent).length / 1024
            )}KB)`
          );

          const doc = await createSingleDocument(
            docTitle,
            fullContent,
            folderId
          );
          documents.push(doc);

          // Reset for next document
          currentDocContent = line + "\n";
          docNumber++;
        } else {
          currentDocContent = potentialContent;
        }
      }

      // Create final document if any content remains
      if (currentDocContent.length > 0) {
        const docTitle = `${title}_Part${docNumber}`;
        const fullContent = headerContent + currentDocContent;

        console.log(
          `Creating final document part ${docNumber} (${Math.round(
            new TextEncoder().encode(fullContent).length / 1024
          )}KB)`
        );

        const doc = await createSingleDocument(docTitle, fullContent, folderId);
        documents.push(doc);
      }

      console.log(
        `✅ Created ${documents.length} documents for large conversation`
      );

      // Return the first document info (for compatibility)
      return {
        docId: documents[0].docId,
        title: `${title} (${documents.length} parts)`,
        url: documents[0].url,
        parts: documents,
      };
    };

    // Helper function to create a single document (used by both single and multi-document creation)
    const createSingleDocument = async (title, content, folderId) => {
      // Create document with retry logic
      const docResponse = await retryWithBackoff(async () => {
        return await axios($, {
          method: "POST",
          url: "https://docs.googleapis.com/v1/documents",
          headers: {
            Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
            "Content-Type": "application/json",
          },
          data: { title: title },
        });
      });

      const docId = docResponse.documentId;
      const contentBytes = new TextEncoder().encode(content).length;
      const maxChunkSize = 50 * 1024; // 50KB in bytes (smaller chunks for better reliability)

      if (contentBytes > maxChunkSize) {
        console.log(
          `⚠️ Large content detected (${Math.round(
            contentBytes / 1024
          )}KB), splitting into chunks...`
        );

        // Find header end for chunking
        const lines = content.split("\n");
        let headerEndIndex = 0;
        let foundSeparator = false;
        let headerContent = "";

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("=".repeat(10))) {
            foundSeparator = true;
          }

          headerContent += lines[i] + "\n";

          if (
            foundSeparator &&
            i + 1 < lines.length &&
            lines[i + 1].trim() === ""
          ) {
            headerContent += "\n";
            headerEndIndex = i + 2;
            break;
          }
        }

        // Insert header first with retry logic
        await retryWithBackoff(async () => {
          return await axios($, {
            method: "POST",
            url: `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
            headers: {
              Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
              "Content-Type": "application/json",
            },
            data: {
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: headerContent,
                  },
                },
                {
                  updateTextStyle: {
                    range: {
                      startIndex: 1,
                      endIndex: headerContent.length + 1,
                    },
                    textStyle: {
                      bold: true,
                    },
                    fields: "bold",
                  },
                },
              ],
            },
          });
        });

        // Process remaining content in chunks with dynamic index tracking
        const remainingLines = lines.slice(headerEndIndex);
        let currentChunk = "";

        for (let i = 0; i < remainingLines.length; i++) {
          const line = remainingLines[i] + "\n";
          const potentialChunk = currentChunk + line;

          // Check if adding this line would exceed chunk size
          if (
            new TextEncoder().encode(potentialChunk).length > maxChunkSize &&
            currentChunk.length > 0
          ) {
            // Get current document length before insertion
            const docResponse = await retryWithBackoff(async () => {
              return await axios($, {
                url: `https://docs.googleapis.com/v1/documents/${docId}`,
                method: "GET",
                headers: {
                  Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
                },
              });
            });

            // Calculate the current end index from the document
            let currentEndIndex = 1;
            if (docResponse.body && docResponse.body.content) {
              for (const element of docResponse.body.content) {
                if (element.endIndex) {
                  currentEndIndex = Math.max(currentEndIndex, element.endIndex);
                }
              }
            }

            // Insert current chunk at the end of the document
            await retryWithBackoff(async () => {
              return await axios($, {
                method: "POST",
                url: `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
                headers: {
                  Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
                  "Content-Type": "application/json",
                },
                data: {
                  requests: [
                    {
                      insertText: {
                        location: { index: currentEndIndex - 1 }, // Insert before the last character
                        text: currentChunk,
                      },
                    },
                  ],
                },
              });
            });

            console.log(
              `Inserted chunk (${Math.round(
                new TextEncoder().encode(currentChunk).length / 1024
              )}KB) at index ${currentEndIndex - 1}`
            );
            currentChunk = line;

            // Add delay between chunks to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            currentChunk = potentialChunk;
          }
        }

        // Insert final chunk if any content remains
        if (currentChunk.length > 0) {
          // Get final document length
          const docResponse = await retryWithBackoff(async () => {
            return await axios($, {
              url: `https://docs.googleapis.com/v1/documents/${docId}`,
              method: "GET",
              headers: {
                Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
              },
            });
          });

          let currentEndIndex = 1;
          if (docResponse.body && docResponse.body.content) {
            for (const element of docResponse.body.content) {
              if (element.endIndex) {
                currentEndIndex = Math.max(currentEndIndex, element.endIndex);
              }
            }
          }

          await retryWithBackoff(async () => {
            return await axios($, {
              method: "POST",
              url: `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
              headers: {
                Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
                "Content-Type": "application/json",
              },
              data: {
                requests: [
                  {
                    insertText: {
                      location: { index: currentEndIndex - 1 },
                      text: currentChunk,
                    },
                  },
                ],
              },
            });
          });
          console.log(
            `Inserted final chunk (${Math.round(
              new TextEncoder().encode(currentChunk).length / 1024
            )}KB) at index ${currentEndIndex - 1}`
          );
        }
      } else {
        // Normal processing for smaller content
        const lines = content.split("\n");
        let headerEndIndex = 1;
        let foundSeparator = false;

        for (let i = 0; i < lines.length; i++) {
          headerEndIndex += lines[i].length + 1;

          if (lines[i].includes("=".repeat(10))) {
            foundSeparator = true;
          }

          if (
            foundSeparator &&
            i + 1 < lines.length &&
            lines[i + 1].trim() === ""
          ) {
            headerEndIndex += 1;
            break;
          }
        }

        await retryWithBackoff(async () => {
          return await axios($, {
            method: "POST",
            url: `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
            headers: {
              Authorization: `Bearer ${this.google_docs.$auth.oauth_access_token}`,
              "Content-Type": "application/json",
            },
            data: {
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: content,
                  },
                },
                {
                  updateTextStyle: {
                    range: {
                      startIndex: 1,
                      endIndex: headerEndIndex,
                    },
                    textStyle: {
                      bold: true,
                    },
                    fields: "bold",
                  },
                },
              ],
            },
          });
        });
      }

      // Move to folder
      await axios($, {
        method: "PATCH",
        url: `https://www.googleapis.com/drive/v3/files/${docId}`,
        headers: {
          Authorization: `Bearer ${this.google_drive.$auth.oauth_access_token}`,
        },
        params: {
          addParents: folderId,
        },
      });

      return {
        docId,
        title,
        url: `https://docs.google.com/document/d/${docId}`,
      };
    };

    // Helper function to create Google Doc with formatted header and chunking for large content
    const createGoogleDoc = async (title, content, folderId) => {
      try {
        // Add _Part1 suffix for single documents to match naming convention
        const docTitle = `${title}_Part1`;
        console.log(`Creating Google Doc: ${docTitle}`);

        const contentBytes = new TextEncoder().encode(content).length;
        const maxDocumentSize = 800 * 1024; // 800KB max per document (safer limit)

        console.log(
          `📊 Content size: ${
            Math.round((contentBytes / 1024 / 1024) * 100) / 100
          }MB (limit: ${
            Math.round((maxDocumentSize / 1024 / 1024) * 100) / 100
          }MB)`
        );

        // If content is extremely large, split into multiple documents
        if (contentBytes > maxDocumentSize) {
          console.log(
            `⚠️ Extremely large content detected (${Math.round(
              contentBytes / 1024 / 1024
            )}MB), splitting into multiple documents...`
          );
          return await createMultipleDocuments(title, content, folderId);
        }

        // Use single document creation for normal-sized content
        return await createSingleDocument(docTitle, content, folderId);
      } catch (error) {
        console.error(`❌ Error creating document for ${title}:`, error);
        throw error;
      }
    };

    // Helper function to get user lookup map
    const getUserLookupMap = async () => {
      try {
        console.log("Building user lookup map for message formatting...");

        const usersResponse = await axios($, {
          url: "https://slack.com/api/users.list",
          headers: {
            Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
          },
        });

        if (!usersResponse.ok) {
          console.warn(
            "Could not fetch users for lookup map, using IDs as fallback"
          );
          return {};
        }

        const userLookupMap = {};
        usersResponse.members.forEach((user) => {
          if (!user.deleted) {
            userLookupMap[user.id] =
              user.profile?.display_name ||
              user.real_name ||
              user.name ||
              user.id;
          }
        });

        console.log(
          `Built lookup map for ${Object.keys(userLookupMap).length} users`
        );
        return userLookupMap;
      } catch (error) {
        console.warn("Error building user lookup map:", error);
        return {};
      }
    };

    // Helper function to format messages
    const formatMessages = (
      messages,
      conversationTitle,
      conversationType,
      userLookupMap = {}
    ) => {
      let content = `${conversationTitle}\n`;
      content += `Export Date: ${new Date().toISOString()}\n`;
      content += `Type: ${conversationType}\n`;
      content += `Total Messages: ${messages.length}\n`;
      content += `${"=".repeat(60)}\n\n`;

      for (const message of messages) {
        if (message.subtype === "bot_message" || message.bot_id) continue;

        const date = new Date(message.ts * 1000);

        // Resolve user ID to display name
        let userName = "Unknown User";
        if (message.user_profile?.display_name) {
          userName = message.user_profile.display_name;
        } else if (message.user && userLookupMap[message.user]) {
          userName = userLookupMap[message.user];
        } else if (message.user) {
          userName = message.user; // Fallback to user ID
        }

        let text = message.text || "[No text content]";

        // Replace user mentions (@USERID) with actual names
        text = text.replace(
          /<@([UW][A-Z0-9]+)(\|[^>]+)?>/g,
          (match, userId, label) => {
            if (label) {
              // If there's a label after |, use it (remove the |)
              return `@${label.substring(1)}`;
            } else if (userLookupMap[userId]) {
              // Look up the user name
              return `@${userLookupMap[userId]}`;
            } else {
              // Fallback to the user ID
              return `@${userId}`;
            }
          }
        );

        // Replace channel mentions (#CHANNELID) with channel names if possible
        text = text.replace(
          /<#([C][A-Z0-9]+)(\|[^>]+)?>/g,
          (match, channelId, label) => {
            if (label) {
              return `#${label.substring(1)}`;
            } else {
              return `#${channelId}`;
            }
          }
        );

        // Replace special formatting
        text = text.replace(/<!here>/g, "@here");
        text = text.replace(/<!channel>/g, "@channel");
        text = text.replace(/<!everyone>/g, "@everyone");

        content += `[${date.toLocaleString()}] ${userName}:\n${text}\n\n`;
      }

      return content;
    };

    // Main execution
    const folders = await setupFolder();
    const userMap = await resolveUsers();
    const channelMap = await findChannels();
    const userLookupMap = await getUserLookupMap();

    // Process DMs
    console.log("Processing DM conversations...");
    for (const userEntry of this.target_users) {
      const targetUserName = userEntry.split(":")[0].trim();
      const userInfo = userMap[targetUserName];
      if (!userInfo) {
        console.warn(`⚠️ User not resolved: ${targetUserName}`);
        results.failed_exports.push({
          type: "DM",
          name: targetUserName,
          error: "User not found or resolved",
        });
        continue;
      }

      try {
        // Open DM channel
        const dmResponse = await axios($, {
          method: "POST",
          url: "https://slack.com/api/conversations.open",
          headers: {
            Authorization: `Bearer ${this.slack.$auth.oauth_access_token}`,
            "Content-Type": "application/json",
          },
          data: { users: userInfo.id },
        });

        if (!dmResponse.ok) {
          throw new Error(`Failed to open DM: ${dmResponse.error}`);
        }

        const messages = await fetchAllMessages(
          dmResponse.channel.id,
          `DM with ${targetUserName}`
        );

        if (messages.length > 0) {
          // Use the "Andrew ↔ Maria" format for DM document titles
          const currentUserName = this.person_name || "User";
          const docTitle = `${currentUserName} ↔ ${userInfo.display_name}`;
          const docContent = formatMessages(
            messages,
            docTitle,
            "Direct Message",
            userLookupMap
          );
          const targetFolder = this.create_subfolders
            ? folders.dm
            : folders.main;
          const doc = await createGoogleDoc(docTitle, docContent, targetFolder);

          results.successful_exports.push({
            type: "DM",
            name: targetUserName,
            display_name: userInfo.display_name,
            message_count: messages.length,
            doc: doc,
            user_id: userInfo.id,
            resolution_method: userInfo.source,
          });

          results.total_messages += messages.length;
          results.total_documents += 1;
        } else {
          console.log(`No messages found for DM with ${targetUserName}`);
          results.skipped_exports.push({
            type: "DM",
            name: targetUserName,
            display_name: userInfo.display_name,
            reason: "No messages found",
          });
        }
      } catch (error) {
        console.error(`❌ Failed to process DM with ${targetUserName}:`, error);
        results.failed_exports.push({
          type: "DM",
          name: targetUserName,
          error: error.message,
        });
      }
    }

    // Process Channels
    console.log("Processing channel conversations...");
    for (const [channelName, channelInfo] of Object.entries(channelMap)) {
      try {
        const messages = await fetchAllMessages(
          channelInfo.channel_id,
          `#${channelName}`
        );

        if (messages.length > 0) {
          // Use the "#channel-name" format for channel document titles
          const docTitle = `#${channelInfo.name}`;
          const docContent = formatMessages(
            messages,
            docTitle,
            `Channel ${channelInfo.is_private ? "(Private)" : "(Public)"}${
              channelInfo.is_archived ? " (Archived)" : ""
            }`,
            userLookupMap
          );
          const targetFolder = this.create_subfolders
            ? folders.channel
            : folders.main;
          const doc = await createGoogleDoc(docTitle, docContent, targetFolder);

          results.successful_exports.push({
            type: "Channel",
            name: channelName,
            display_name: channelInfo.name,
            is_archived: channelInfo.is_archived,
            message_count: messages.length,
            doc: doc,
          });

          results.total_messages += messages.length;
          results.total_documents += 1;
        } else {
          console.log(`📭 No messages found for channel #${channelName}`);
          results.skipped_exports.push({
            type: "Channel",
            name: channelName,
            display_name: channelInfo.name,
            reason: "No messages found",
          });
        }
      } catch (error) {
        console.error(`❌ Failed to process channel #${channelName}:`, error);
        results.failed_exports.push({
          type: "Channel",
          name: channelName,
          error: error.message,
        });
      }
    }

    // Create summary document
    console.log("📊 Creating summary document...");
    const personSuffix = this.person_name ? ` ${this.person_name}` : "";
    const summaryTitle = `Slack Export Summary${personSuffix} - ${
      new Date().toISOString().split("T")[0]
    }`;
    let summaryContent = `Slack Conversations Export Summary\n`;
    summaryContent += `Export Date: ${new Date().toISOString()}\n`;
    summaryContent += `${"=".repeat(60)}\n\n`;

    summaryContent += `STATISTICS:\n`;
    summaryContent += `- Documents Created: ${results.total_documents}\n`;
    summaryContent += `- Messages Exported: ${results.total_messages}\n`;
    summaryContent += `- Successful Exports: ${results.successful_exports.length}\n`;
    summaryContent += `- Skipped Exports: ${results.skipped_exports.length}\n`;
    summaryContent += `- Failed Exports: ${results.failed_exports.length}\n\n`;

    summaryContent += `SUCCESSFUL EXPORTS:\n`;
    for (const export_ of results.successful_exports) {
      summaryContent += `✅ ${export_.type}: ${
        export_.display_name || export_.name
      }\n`;
      summaryContent += `   Messages: ${export_.message_count}\n`;
      summaryContent += `   Document: ${export_.doc.url}\n\n`;
    }

    if (results.skipped_exports.length > 0) {
      summaryContent += `SKIPPED EXPORTS:\n`;
      for (const skipped of results.skipped_exports) {
        summaryContent += `⚠️ ${skipped.type}: ${
          skipped.display_name || skipped.name
        }\n`;
        summaryContent += `   Reason: ${skipped.reason}\n\n`;
      }
    }

    if (results.failed_exports.length > 0) {
      summaryContent += `FAILED EXPORTS:\n`;
      for (const failed of results.failed_exports) {
        summaryContent += `❌ ${failed.type}: ${failed.name} - ${failed.error}\n`;
      }
    }

    const summaryDoc = await createGoogleDoc(
      summaryTitle,
      summaryContent,
      folders.main
    );

    console.log("Export completed!");
    console.log(`All documents saved to: ${this.drive_folder_name}`);
    if (this.person_name) {
      console.log(`Historical export completed for: ${this.person_name}`);
    }
    console.log(`Summary: ${summaryDoc.url}`);

    return {
      summary: {
        total_documents: results.total_documents + 1, // +1 for summary doc
        total_messages: results.total_messages,
        successful_exports: results.successful_exports.length,
        skipped_exports: results.skipped_exports.length,
        failed_exports: results.failed_exports.length,
        person_name: this.person_name,
        folder_id: folders.main,
        dm_folder_id: folders.dm,
        channel_folder_id: folders.channel,
        summary_doc: summaryDoc,
      },
      exports: results.successful_exports,
      skipped: results.skipped_exports,
      failures: results.failed_exports,
      folder_url: `https://drive.google.com/drive/folders/${folders.main}`,
    };
  },
});
