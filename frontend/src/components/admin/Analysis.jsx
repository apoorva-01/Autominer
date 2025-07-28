import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { Play, RefreshCw, CheckCircle, XCircle, Clock, Shield, Users, Briefcase, ArrowRightLeft, Search, Filter, ChevronDown, Zap } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import SimpleSnackbar from '../common/SimpleSnackbar';
import Skeleton from '../common/Skeleton';
import './Analysis.css';
import { Link } from 'react-router-dom';

function Analysis() {
  const [selectedTeam, setSelectedTeam] = useState(''); // Changed from selectedConnection to selectedTeam
  const [selectedConnection, setSelectedConnection] = useState(''); // Keep for backward compatibility
  const [channels, setChannels] = useState([]);
  const [allTeamChannels, setAllTeamChannels] = useState([]); // Store all channels for the team
  const [selectedChannel, setSelectedChannel] = useState('');
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [conversationLength, setConversationLength] = useState(50);
  const [selectedChannels, setSelectedChannels] = useState([]); // Multi-select
  const [people, setPeople] = useState([]); // All people in workspace
  const [selectedPerson, setSelectedPerson] = useState('');
  const [tab, setTab] = useState('standard');
  const [departments, setDepartments] = useState([]);
  const [selectedDept1, setSelectedDept1] = useState('');
  const [selectedDept2, setSelectedDept2] = useState('');
  const [selectedDepts, setSelectedDepts] = useState([]); // replaces selectedDept1/2
  const [deptResults, setDeptResults] = useState(null);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptError, setDeptError] = useState('');
  // Intra-department state
  const [selectedIntraDept, setSelectedIntraDept] = useState('');
  const [intraDeptResults, setIntraDeptResults] = useState(null);
  const [intraDeptLoading, setIntraDeptLoading] = useState(false);
  const [intraDeptError, setIntraDeptError] = useState('');
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const [channelSearch, setChannelSearch] = useState('');
  const [availableConnections, setAvailableConnections] = useState([]); // Store connections for selected team
  // Add a new state variable to track the current analysis ID
  const [currentAnalysisId, setCurrentAnalysisId] = useState(null);
  // Add state variables to track the current analysis IDs for each tab
  const [currentIntraDeptAnalysisId, setCurrentIntraDeptAnalysisId] = useState(null);
  const [currentInterDeptAnalysisId, setCurrentInterDeptAnalysisId] = useState(null);

  // Fetch channels and people when team changes
  useEffect(() => {
    setSelectedChannels([]);
    setChannels([]);
    setAllTeamChannels([]); // Reset stored full channel list
    setSelectedYear('');
    setYears([]);
    setPeople([]);
    setSelectedPerson('');
    setSelectedConnection(''); // Reset connection when team changes
    
    if (selectedTeam) {
      console.log(`Fetching data for team: ${selectedTeam}`);
      
      // Find all connections for this team
      axios.get(`/api/slack/admin/connections-by-team?slackTeamId=${selectedTeam}`)
        .then(res => {
          const teamConnections = res.data.connections || [];
          console.log(`Found ${teamConnections.length} connections for team ${selectedTeam}`);
          setAvailableConnections(teamConnections);
          
          // If there are connections, get channels from all connections for this team
          if (teamConnections.length > 0) {
            // Collect all channels from all connections
            const fetchAllChannels = async () => {
              try {
                const allChannels = [];
                const channelMap = new Map(); // To avoid duplicates
                
                // Process connections sequentially to avoid rate limiting
                for (const connection of teamConnections) {
                  try {
                    const response = await axios.get(`/api/analysis/channels?connectionId=${connection.id}`);
                    const connectionChannels = response.data.channels || [];
                    
                    // Add unique channels to our map (avoid duplicates by channelId)
                    connectionChannels.forEach(channel => {
                      if (!channelMap.has(channel.channelId)) {
                        channelMap.set(channel.channelId, {
                          id: channel.channelId,
                          name: channel.channelName,
                          connectionId: connection.id
                        });
                      }
                    });
                  } catch (err) {
                    console.warn(`Error fetching channels for connection ${connection.id}:`, err);
                    // Continue with other connections even if one fails
                  }
                }
                
                // Convert map to array
                const uniqueChannels = Array.from(channelMap.values());
                console.log(`Found ${uniqueChannels.length} unique channels across all connections`);
                
                // Update state with all unique channels and store the full list
                setChannels(uniqueChannels);
                setAllTeamChannels(uniqueChannels); // Store the full list for later use
              } catch (err) {
                console.error("Error fetching all channels:", err);
                setSnackbar({
                  isVisible: true,
                  message: `Error fetching channels: ${err.response?.data?.error || err.message}`,
                  type: 'error'
                });
              }
            };
            
            fetchAllChannels();
          }
        })
        .catch(err => {
          console.error("Error fetching connections:", err);
          setSnackbar({
            isVisible: true,
            message: `Error fetching connections: ${err.response?.data?.error || err.message}`,
            type: 'error'
          });
        });
      
      // Get all people across all connections for this team
      axios.get(`/api/analysis/team-people?slackTeamId=${selectedTeam}`)
        .then(res => {
          console.log(`Found ${res.data.people?.length || 0} people for team ${selectedTeam}`);
          setPeople(res.data.people || []);
        })
        .catch(err => {
          console.error("Error fetching people:", err);
          setSnackbar({
            isVisible: true,
            message: `Error fetching people: ${err.response?.data?.error || err.message}`,
            type: 'error'
          });
        });
    }
  }, [selectedTeam]);

  // When a person is selected, filter channels to only show their channels
  useEffect(() => {
    if (selectedPerson && people.length > 0) {
      const person = people.find(p => p.id === selectedPerson);
      
      if (person && person.channelIds && person.channelIds.length > 0) {
        // Filter to only show channels this person is in
        // Use allTeamChannels to ensure we filter from the complete list
        const personChannels = allTeamChannels.filter(channel => 
          person.channelIds.includes(channel.id)
        );
        console.log(`Filtered to ${personChannels.length} channels for selected person`);
        
        // Update the channels list to only show this person's channels
        setChannels(personChannels);
        
        // Pre-select their channels
        setSelectedChannels(personChannels.map(c => c.id));
        
        // If person has connectionIds, use the first one
        if (person.connectionIds && person.connectionIds.length > 0) {
          setSelectedConnection(person.connectionIds[0]);
        }
      }
    } else if (!selectedPerson && selectedTeam) {
      // When "All People" is selected, reset channel selection and restore the full channel list
      setSelectedChannels([]);
      
      // Use the stored full channel list instead of re-fetching
      if (allTeamChannels.length > 0) {
        console.log(`Restoring full channel list with ${allTeamChannels.length} channels`);
        setChannels(allTeamChannels);
      } else {
        // If for some reason we don't have the full list stored, re-fetch it
        console.log("No stored channel list found, re-fetching all channels");
        axios.get(`/api/slack/admin/connections-by-team?slackTeamId=${selectedTeam}`)
          .then(res => {
            const teamConnections = res.data.connections || [];
            setAvailableConnections(teamConnections);
            
            if (teamConnections.length > 0) {
              const fetchAllChannels = async () => {
                try {
                  const allChannels = [];
                  const channelMap = new Map();
                  
                  for (const connection of teamConnections) {
                    try {
                      const response = await axios.get(`/api/analysis/channels?connectionId=${connection.id}`);
                      const connectionChannels = response.data.channels || [];
                      
                      connectionChannels.forEach(channel => {
                        if (!channelMap.has(channel.channelId)) {
                          channelMap.set(channel.channelId, {
                            id: channel.channelId,
                            name: channel.channelName,
                            connectionId: connection.id
                          });
                        }
                      });
                    } catch (err) {
                      console.warn(`Error fetching channels for connection ${connection.id}:`, err);
                    }
                  }
                  
                  const uniqueChannels = Array.from(channelMap.values());
                  console.log(`Found ${uniqueChannels.length} unique channels across all connections`);
                  
                  setChannels(uniqueChannels);
                  setAllTeamChannels(uniqueChannels); // Also update the stored full list
                } catch (err) {
                  console.error("Error fetching all channels:", err);
                  setSnackbar({
                    isVisible: true,
                    message: `Error fetching channels: ${err.response?.data?.error || err.message}`,
                    type: 'error'
                  });
                }
              };
              
              fetchAllChannels();
            }
          })
          .catch(err => {
            console.error("Error fetching connections:", err);
          });
      }
    }
  }, [selectedPerson, people, allTeamChannels, selectedTeam]);

  // Fetch years when channel changes
  useEffect(() => {
    setSelectedYear('');
    setYears([]);
    if (selectedConnection && selectedChannel) {
      axios.get(`/api/analysis/years?connectionId=${selectedConnection}&channelId=${selectedChannel}`).then(res => {
        setYears(res.data.years || []);
      });
    }
  }, [selectedConnection, selectedChannel]);

  // Fetch departments when team changes (for department tab)
  useEffect(() => {
    if (selectedTeam) {
      console.log(`Fetching departments for team: ${selectedTeam}`);
      axios.get(`/api/analysis/departments?slackTeamId=${selectedTeam}`)
        .then(res => {
          console.log(`Found ${res.data.departments?.length || 0} departments for team ${selectedTeam}`);
          setDepartments(res.data.departments || []);
        })
        .catch(err => {
          console.error("Failed to fetch departments:", err);
          setDepartments([]);
          setSnackbar({
            isVisible: true,
            message: `Error fetching departments: ${err.response?.data?.error || err.message}`,
            type: 'error'
          });
        });
    } else {
      setDepartments([]);
    }
    setSelectedDept1('');
    setSelectedDept2('');
    setSelectedDepts([]); // Reset multi-select
    setDeptResults(null);
    setDeptError('');
    setSelectedIntraDept('');
    setIntraDeptResults(null);
    setIntraDeptError('');
  }, [selectedTeam]);

  // Check if user is admin
  if (!isAdmin) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <Shield size={48} />
          <h2>Admin Access Required</h2>
          <p>Analysis features are only available to administrators.</p>
          <p>Please contact your administrator for access.</p>
        </div>
      </div>
    );
  }

  const { data: connections } = useQuery('slack-connections', async () => {
    const response = await axios.get('/api/slack/connections');
    return response.data.connections;
  });
  
  // Group connections by team name to show unique workspaces
  const uniqueTeams = useMemo(() => {
    if (!connections) return [];
    
    // Create a map of team IDs to team info
    const teamMap = new Map();
    connections.forEach(connection => {
      const teamId = connection.slackTeamId;
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, {
          id: teamId,
          name: connection.slackTeamName
        });
      }
    });
    
    // Convert map values to array
    return Array.from(teamMap.values());
  }, [connections]);

  // Modify the results query to filter by the current analysis ID
  const { data: results, isLoading: resultsLoading, isFetching, refetch } = useQuery(
    ['analysis-results', currentAnalysisId],
    async () => {
      const params = {};
      if (currentAnalysisId) {
        params.analysisId = currentAnalysisId;
      }
      const response = await axios.get('/api/analysis/results', { params });
      return response.data;
    },
    {
      refetchOnWindowFocus: true,
      refetchInterval: false,
      staleTime: 0,
      enabled: !!currentAnalysisId, // Only fetch results when we have an analysis ID
    }
  );

  const runAnalysisMutation = useMutation(
    (data) => axios.post('/api/analysis/run', data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('analysis-results');
        queryClient.invalidateQueries('analysis-summary');
      },
    }
  );

  const updateTaskStatusMutation = useMutation(
    ({ taskId, status }) => axios.patch(`/api/analysis/tasks/${taskId}/status`, { status }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('analysis-results');
      },
    }
  );

  // Update the handleRunAnalysis function to set the current analysis ID
  const handleRunAnalysis = () => {
    // If a person is selected, we need to find which connection they belong to
    let connectionToUse = selectedConnection;
    
    if (selectedPerson && !connectionToUse) {
      // Find the person in the people array
      const person = people.find(p => p.id === selectedPerson);
      console.log("Selected person:", person);
      
      // If they have connectionIds, use the first one
      if (person && person.connectionIds && Array.isArray(person.connectionIds) && person.connectionIds.length > 0) {
        connectionToUse = person.connectionIds[0];
        console.log(`Using connection ${connectionToUse} from person's connections`);
      } else if (availableConnections.length > 0) {
        // Fallback to the first available connection
        connectionToUse = availableConnections[0].id;
        console.log(`Falling back to first available connection: ${connectionToUse}`);
      }
    } else if (selectedChannels.length > 0 && !connectionToUse) {
      // If channels are selected but no connection, try to find the connection for the first selected channel
      const firstSelectedChannel = channels.find(c => c.id === selectedChannels[0]);
      if (firstSelectedChannel && firstSelectedChannel.connectionId) {
        connectionToUse = firstSelectedChannel.connectionId;
        console.log(`Using connection ${connectionToUse} from selected channel`);
      } else if (availableConnections.length > 0) {
        // Fallback to the first available connection
        connectionToUse = availableConnections[0].id;
        console.log(`No connection found for selected channel, using first available: ${connectionToUse}`);
      }
    } else if (!connectionToUse && availableConnections.length > 0) {
      // If no connection is selected, use the first available one
      connectionToUse = availableConnections[0].id;
      console.log(`No connection selected, using first available: ${connectionToUse}`);
    }
    
    if (!connectionToUse) {
      setSnackbar({
        isVisible: true,
        message: "No valid connection found. Please try selecting a different workspace or person.",
        type: 'error'
      });
      return;
    }
    
    // Get analysis context for better messages
    const analysisContext = selectedPerson 
      ? `for ${people.find(p => p.id === selectedPerson)?.name || 'selected person'}`
      : selectedChannels.length > 0 
        ? `for ${selectedChannels.length} selected channel${selectedChannels.length !== 1 ? 's' : ''}`
        : 'for selected workspace';
    
    console.log(`Running analysis with connection: ${connectionToUse}, channels: ${selectedChannels.length}, person: ${selectedPerson || 'none'}`);
    
    runAnalysisMutation.mutate({
      connectionId: connectionToUse,
      channelIds: selectedChannels.length > 0 ? selectedChannels : undefined,
      personId: selectedPerson || undefined,
      slackTeamId: selectedTeam
    }, {
      onSuccess: (data) => {
        console.log("Analysis success:", data.data);
        const taskCount = data.data.totalTasksFound || data.data.tasksFound || 0;
        
        // Set the current analysis ID to the newly created analysis
        if (data.data.analysisId) {
          setCurrentAnalysisId(data.data.analysisId);
          // Refetch results with the new analysis ID
          queryClient.invalidateQueries(['analysis-results', data.data.analysisId]);
        }
        
        // Use the message from the backend if available
        const backendMessage = data.data.message || '';
        
        setSnackbar({
          isVisible: true,
          message: backendMessage || `Analysis complete ${analysisContext}! ${taskCount > 0 
            ? `Found ${taskCount} automation opportunities.` 
            : 'Analysis completed successfully.'}`,
          type: 'success'
        });
      },
      onError: (error) => {
        console.error("Analysis error:", error);
        setSnackbar({
          isVisible: true,
          message: error?.response?.data?.error || 'Analysis failed. Please try again.',
          type: 'error'
        });
      }
    });
  };

  const handleStatusChange = (taskId, status) => {
    updateTaskStatusMutation.mutate({ taskId, status });
  };

  // Update the handleRunDeptAnalysis function to set the current inter-department analysis ID
  const handleRunDeptAnalysis = () => {
    setDeptLoading(true);
    setDeptError('');
    setDeptResults(null);
    
    // Validate data before sending
    if (!selectedDepts || selectedDepts.length < 2) {
      setDeptError('Please select at least 2 departments');
      setDeptLoading(false);
      setSnackbar({
        isVisible: true,
        message: 'Please select at least 2 departments for inter-department analysis',
        type: 'error'
      });
      return;
    }
    
    // Find a valid connection for the selected team
    let connectionToUse = null;
    if (availableConnections.length > 0) {
      // Use the first available connection
      connectionToUse = availableConnections[0].id;
      console.log(`Using connection: ${connectionToUse}`);
    }
    
    if (!connectionToUse) {
      setDeptError('No valid connection found for this team');
      setDeptLoading(false);
      setSnackbar({
        isVisible: true,
        message: 'No valid connection found for this team. Please connect to Slack first.',
        type: 'error'
      });
      return;
    }
    
    const data = {
      connectionId: connectionToUse,
      departmentIds: selectedDepts,
    };
    
    console.log(`Running inter-department analysis with connection ${connectionToUse} and departments:`, selectedDepts);
    
    axios.post('/api/analysis/department-analysis', data)
      .then(res => {
        console.log("Inter-department analysis response:", res.data);
        
        // Set the current inter-department analysis ID
        if (res.data.analysisId) {
          setCurrentInterDeptAnalysisId(res.data.analysisId);
        }
        
        setDeptResults(res.data);
        setDeptLoading(false);
        
        // If we got a success response but need to fetch tasks separately
        if (res.data.success && !res.data.tasks) {
          console.log("Fetching tasks for completed analysis...");
          // Fetch the latest tasks for this specific analysis
          const params = {};
          if (res.data.analysisId) {
            params.analysisId = res.data.analysisId;
          }
          
          axios.get('/api/analysis/results', { params })
            .then(tasksRes => {
              const tasks = tasksRes.data.tasks || [];
              const updatedResults = {
                ...res.data,
                tasks: tasks
              };
              setDeptResults(updatedResults);
              
                          // Show success snackbar with task count
            setSnackbar({
              isVisible: true,
              message: res.data.message || `Analysis complete! Found ${tasks.length} automation opportunities between departments.`,
              type: 'success'
            });
            })
            .catch(err => {
              console.error("Failed to fetch tasks:", err);
              
                          // Still show success message even if tasks fetch fails
            setSnackbar({
              isVisible: true,
              message: res.data.message || `Inter-department analysis completed successfully!`,
              type: 'success'
            });
            });
        } else {
                  // Direct success message for immediate results
        const taskCount = res.data.tasks?.length || res.data.tasksFound || 0;
        setSnackbar({
          isVisible: true,
          message: res.data.message || `Inter-department analysis complete! ${taskCount > 0 
            ? `Found ${taskCount} automation opportunities.` 
            : 'Analysis completed successfully.'}`,
          type: 'success'
        });
        }
      })
      .catch(err => {
        console.error("Inter-department analysis error:", err);
        const errorMsg = err.response?.data?.error || 'Failed to run inter-department analysis';
        setDeptError(errorMsg);
        setDeptLoading(false);
        setSnackbar({
          isVisible: true,
          message: errorMsg,
          type: 'error'
        });
      });
  };

  // Update the handleRunIntraDeptAnalysis function to set the current intra-department analysis ID
  const handleRunIntraDeptAnalysis = () => {
    setIntraDeptLoading(true);
    setIntraDeptError('');
    setIntraDeptResults(null);
    
    // Find the department name for better messaging
    const departmentName = departments.find(d => d.id === selectedIntraDept)?.name || 'department';
    
    const data = {
      departmentId: selectedIntraDept,
    };
    // Only include connectionId if selected (for backward compatibility)
    if (selectedConnection) {
      data.connectionId = selectedConnection;
    }
    axios.post('/api/analysis/intra-department-analysis', data)
      .then(res => {
        // Set the current intra-department analysis ID
        if (res.data.analysisId) {
          setCurrentIntraDeptAnalysisId(res.data.analysisId);
        }
        
        // Check for different response structures and normalize
        let normalizedResults = res.data;
        
        // If the tasks are not directly in the response but nested in a property
        if (!normalizedResults.tasks && normalizedResults.success) {
          // Create a normalized structure that matches what the UI expects
          normalizedResults = {
            tasks: [], // Initialize empty array
            ...normalizedResults
          };
          
          // Fetch the tasks for this specific analysis
          const params = {};
          if (res.data.analysisId) {
            params.analysisId = res.data.analysisId;
          } else if (selectedConnection) {
            params.connectionId = selectedConnection;
          }
          
          axios.get('/api/analysis/results', { params })
            .then(tasksRes => {
              const tasks = tasksRes.data.tasks || [];
              normalizedResults.tasks = tasks;
              setIntraDeptResults(normalizedResults);
              
              // Show success message with task count
              const taskCount = tasks.length;
              setSnackbar({
                isVisible: true,
                message: res.data.message || `${departmentName} analysis complete! ${taskCount > 0 
                  ? `Found ${taskCount} automation opportunities within the department.` 
                  : 'Analysis completed successfully.'}`,
                type: 'success'
              });
            })
            .catch(err => {
              // Still set the results without tasks
              setIntraDeptResults(normalizedResults);
              
              // Show general success message
              setSnackbar({
                isVisible: true,
                message: res.data.message || `${departmentName} analysis completed successfully!`,
                type: 'success'
              });
            });
        } else {
          setIntraDeptResults(normalizedResults);
          
          // Direct success message
          const taskCount = normalizedResults.tasks?.length || normalizedResults.tasksFound || 0;
          setSnackbar({
            isVisible: true,
            message: res.data.message || `${departmentName} analysis complete! ${taskCount > 0 
              ? `Found ${taskCount} automation opportunities.` 
              : 'Analysis completed successfully.'}`,
            type: 'success'
          });
        }
        
        setIntraDeptLoading(false);
      })
      .catch(err => {
        setIntraDeptError(err.response?.data?.error || 'Failed to run intra-department analysis');
        setIntraDeptLoading(false);
        setSnackbar({
          isVisible: true,
          message: err.response?.data?.error || 'Failed to run intra-department analysis',
          type: 'error'
        });
      });
  };

  const closeSnackbar = () => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  // Modify the latest results query to only fetch for the current intra-department analysis
  const { data: latestResults, isLoading: latestResultsLoading } = useQuery(
    ['latest-analysis-results', currentIntraDeptAnalysisId],
    async () => {
      const params = { limit: 50 };
      if (currentIntraDeptAnalysisId) {
        params.analysisId = currentIntraDeptAnalysisId;
      }
      const response = await axios.get('/api/analysis/results', { params });
      return response.data;
    },
    {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minute
      enabled: tab === 'intra' && !!currentIntraDeptAnalysisId // Only fetch when on intra tab and we have an analysis ID
    }
  );

  // Set intra-department results if available
  useEffect(() => {
    if (latestResults && latestResults.tasks && latestResults.tasks.length > 0 && tab === 'intra') {
      // Create a normalized structure
      const normalizedResults = {
        tasks: latestResults.tasks,
        success: true,
        tasksFound: latestResults.tasks.length,
        message: `Found ${latestResults.tasks.length} potential automation tasks`
      };
      setIntraDeptResults(normalizedResults);
    }
  }, [latestResults, tab]);

  return (
    <div className="analysis-container modern-bg">
      {/* <div className="page-header">
        <div className="page-header-content">
          <h1>AI Analysis</h1>
          <p>Run AI analysis on your Slack conversations to discover automation opportunities and optimize team workflows.</p>
        </div>
      </div> */}
      
      <div className="analysis-tab-bar">
        <button
          className={`tab-btn${tab === 'standard' ? ' active' : ''}`}
          onClick={() => setTab('standard')}
          title="Analyze by person or channel"
        >
          <Users size={18} />
          Person/ Channel Analysis
        </button>
        <button
          className={`tab-btn${tab === 'intra' ? ' active' : ''}`}
          onClick={() => setTab('intra')}
          title="Analyze within a department"
        >
          <Briefcase size={18} />
          Intra Department Analysis
        </button>
        <button
          className={`tab-btn${tab === 'department' ? ' active' : ''}`}
          onClick={() => setTab('department')}
          title="Analyze between departments"
        >
          <ArrowRightLeft size={18} />
          Inter Department Analysis
        </button>
      </div>
      
      {/* Skeleton loader for loading states */}
      {((resultsLoading && tab === 'standard') || (deptLoading && tab === 'department')) ? (
        <div className="skeleton-container">
          <Skeleton width="320px" height="2.2em" className="skeleton-header" shape="rounded" />
          <div className="skeleton-row">
            <Skeleton width="220px" height="2em" shape="rounded" />
            <Skeleton width="220px" height="2em" shape="rounded" />
          </div>
          <div className="card skeleton-card">
            <Skeleton width="180px" height="1.5em" className="skeleton-title" shape="rounded" />
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} width="100%" height="32px" className="skeleton-item" shape="rounded" />
            ))}
          </div>
          <div className="analysis-results card">
            <Skeleton width="180px" height="1.5em" className="skeleton-title" shape="rounded" />
            <div className="skeleton-tasks">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} width="320px" height="180px" shape="rounded" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {tab === 'standard' && (
            <>
              <div className="card">
                <form className="analysis-controls-form" onSubmit={e => { e.preventDefault(); handleRunAnalysis(); }}>
                  <div className="form-group">
                    <label htmlFor="team-select">Select Workspace</label>
                    <select
                      id="team-select"
                      value={selectedTeam}
                      onChange={(e) => setSelectedTeam(e.target.value)}
                      className="modern-select"
                    >
                      <option value="">Select Workspace</option>
                      {uniqueTeams?.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="person-select">Select Person (optional)</label>
                    <select
                      id="person-select"
                      value={selectedPerson}
                      onChange={e => setSelectedPerson(e.target.value)}
                      disabled={people.length === 0}
                      className="modern-select"
                    >
                      <option value="">All People</option>
                      {people.map(person => (
                        <option key={person.id} value={person.id}>{person.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group channel-multiselect-group">
                    <label htmlFor="channel-select">Select Channels/DMs</label>
                    <div className="channel-search-wrapper">
                      <Search size={16} className="search-icon" />
                      <input
                        type="text"
                        placeholder="Search channels..."
                        value={channelSearch || ''}
                        onChange={e => setChannelSearch(e.target.value)}
                        className="channel-search-input"
                        disabled={!selectedTeam || channels.length === 0}
                      />
                    </div>
                    <select
                      id="channel-select"
                      multiple
                      value={selectedChannels}
                      onChange={e => setSelectedChannels(Array.from(e.target.selectedOptions, option => option.value))}
                      disabled={!selectedTeam || channels.length === 0}
                      className="modern-select channel-multiselect"
                    >
                      {channels
                        .filter(channel => !channelSearch || channel.name.toLowerCase().includes(channelSearch.toLowerCase()))
                        .map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.name}
                          </option>
                        ))}
                    </select>
                    <div className="channel-multiselect-footer">
                      <small>Hold Cmd/Ctrl to select multiple</small>
                      <span className="selected-count">{selectedChannels.length} selected</span>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="modern-btn run-analysis-button"
                    disabled={runAnalysisMutation.isLoading || !selectedTeam || (!selectedChannels.length && !selectedPerson)}
                    title="Run analysis for selected options"
                  >
                    {runAnalysisMutation.isLoading ? (
                      <><span className="spinner"></span> Analyzing...</>
                    ) : (
                      <><Play size={18} /> Run Analysis</>
                    )}
                  </button>
                </form>
              </div>

              {/* <div className="card">
                <div className="results-header">
                  <h2>Analysis Results</h2>
                  <div className="results-actions">
                    <button onClick={() => { refetch(); }} className="refresh-button modern-btn" title="Refresh results">
                      <RefreshCw size={16} className={isFetching ? 'spinning' : ''} />
                      Refresh
                    </button>
                    <Link to="/automations" className="view-all-button modern-btn" title="View all automations">
                      <Zap size={16} />
                      View All Automations
                    </Link>
                  </div>
                </div>
                
                {resultsLoading ? (
                  <div className="loading"><span className="spinner"></span> Loading results...</div>
                ) : results && results.tasks && results.tasks.length > 0 ? (
                  <div className="tasks-grid">
                    {results.tasks
                      .slice()
                      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                      .map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatusChange={handleStatusChange}
                          isUpdating={updateTaskStatusMutation.isLoading}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Clock size={48} />
                    <p>No analysis results yet. Run your first analysis to discover automation opportunities.</p>
                    <button 
                      className="empty-state-button" 
                      onClick={() => document.querySelector('.run-analysis-button').scrollIntoView({ behavior: 'smooth' })}
                    >
                      Start Analysis
                    </button>
                  </div>
                )}
              </div> */}
            </>
          )}
          
          {tab === 'intra' && (
            <div className="card">
              <div className="info-section">
                <strong>Intra-Department Communication Analysis</strong>
                <ul>
                  <li>All DMs between members of the same department (e.g., Dev A ↔ Dev B)</li>
                  <li>The main department channel (e.g., #dev-team)</li>
                  <li>DMs between any member of the department and their direct supervisor</li>
                  <li>Also includes supervisor ↔ their manager</li>
                </ul>
              </div>
              <form className="intra-department-analysis-controls-form" onSubmit={e => { e.preventDefault(); handleRunIntraDeptAnalysis(); }}>
                <div className="form-group">
                  <label htmlFor="team-select">Select Workspace</label>
                  <select
                    id="team-select"
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    className="modern-select"
                  >
                    <option value="">Select Workspace</option>
                    {uniqueTeams?.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="intra-dept-select">Select Department</label>
                  <select
                    id="intra-dept-select"
                    value={selectedIntraDept}
                    onChange={e => setSelectedIntraDept(e.target.value)}
                    disabled={departments.length === 0}
                    className="modern-select"
                  >
                    <option value="">Select Department</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="modern-btn run-analysis-button"
                  disabled={intraDeptLoading || !selectedTeam || !selectedIntraDept}
                  title="Run intra-department analysis"
                >
                  {intraDeptLoading ? (
                    <><span className="spinner"></span> Analyzing...</>
                  ) : (
                    <><Play size={18} /> Run Intra Department Analysis</>
                  )}
                </button>
              </form>
              {intraDeptError && <div className="error-message">{intraDeptError}</div>}
              
              {/* {intraDeptResults && (
                <div className="analysis-results">
                  <div className="results-header">
                    <h2>Intra Department Analysis Results</h2>
                    <div className="result-meta">
                      {intraDeptResults.tasksFound > 0 && 
                        <span className="chip">{intraDeptResults.tasksFound} tasks found</span>
                      }
                    </div>
                  </div>
                  
                  {intraDeptResults.tasks && intraDeptResults.tasks.length > 0 ? (
                    <div className="tasks-grid">
                      {intraDeptResults.tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatusChange={() => {}}
                          isUpdating={false}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>No intra-department analysis results yet. Try running the analysis.</p>
                      <button 
                        className="empty-state-button" 
                        disabled={intraDeptLoading || !selectedTeam || !selectedIntraDept}
                        onClick={() => selectedTeam && selectedIntraDept ? handleRunIntraDeptAnalysis() : null}
                      >
                        Run Analysis
                      </button>
                    </div>
                  )}
                </div>
              )} */}
            </div>
          )}
          
          {tab === 'department' && (
            <div className="card">
              <div className="info-section">
                <strong>Inter-Department Communication Analysis</strong>
                <ul>
                  <li>All DMs between members of two different departments (e.g., Dev ↔ Design)</li>
                  <li>Any shared Slack channels between departments (e.g., #product-dev-design)</li>
                  <li>Any messages between members of both departments and their common higher-up</li>
                </ul>
              </div>
              <form className="department-analysis-controls-form" onSubmit={e => { e.preventDefault(); handleRunDeptAnalysis(); }}>
                <div className="form-group">
                  <label htmlFor="team-select">Select Workspace</label>
                  <select
                    id="team-select"
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    className="modern-select"
                  >
                    <option value="">Select Workspace</option>
                    {uniqueTeams?.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label htmlFor="depts-select">Select Departments (multi-select)</label>
                  <select
                    id="depts-select"
                    multiple
                    value={selectedDepts}
                    onChange={e => setSelectedDepts(Array.from(e.target.selectedOptions, option => option.value))}
                    disabled={departments.length === 0}
                    className="modern-select"
                    style={{ minHeight: 120 }}
                  >
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                  <div className="select-help">
                    <small>Hold Cmd/Ctrl to select multiple departments</small>
                    <small className={selectedDepts.length < 2 ? "warning-text" : ""}>
                      {selectedDepts.length < 2 ? 'Please select at least 2 departments' : `${selectedDepts.length} departments selected`}
                    </small>
                  </div>
                </div>
                <button
                  type="submit"
                  className="modern-btn run-analysis-button"
                  disabled={deptLoading || !selectedTeam || selectedDepts.length < 2}
                  title="Run inter-department analysis"
                >
                  {deptLoading ? (
                    <><span className="spinner"></span> Analyzing...</>
                  ) : (
                    <><Play size={18} /> Run Inter Department Analysis</>
                  )}
                </button>
              </form>
              {deptError && <div className="error-message">{deptError}</div>}
              
              {deptLoading && (
                <div className="analysis-progress">
                  <div className="progress-indicator">
                    <span className="spinner"></span>
                    <div className="progress-text">
                      <h3>Analysis in progress...</h3>
                      <p>Analyzing communications between departments. This may take a few minutes.</p>
                      <ul className="progress-steps">
                        <li>Finding cross-department DMs</li>
                        <li>Identifying shared channels</li>
                        <li>Detecting common managers</li>
                        <li>Analyzing communication patterns</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              {/* {deptResults && (
                <div className="analysis-results">
                  <div className="results-header">
                    <h2>Inter Department Analysis Results</h2>
                    <div className="result-meta">
                      {deptResults.tasksFound > 0 && 
                        <span className="chip">{deptResults.tasksFound} tasks found</span>
                      }
                    </div>
                  </div>
                  
                  {deptResults.tasks && deptResults.tasks.length > 0 ? (
                    <div className="tasks-grid">
                      {deptResults.tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatusChange={() => {}}
                          isUpdating={false}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>{deptResults.message || 'No automation opportunities found. This could mean either no cross-department communications were found, or no automation opportunities were identified in the communications.'}</p>
                      <button 
                        className="empty-state-button" 
                        disabled={deptLoading || !selectedTeam || selectedDepts.length < 2}
                        onClick={() => selectedTeam && selectedDepts.length >= 2 ? handleRunDeptAnalysis() : null}
                      >
                        Run Analysis Again
                      </button>
                    </div>
                  )}
                </div>
              )} */}
            </div>
          )}
        </>
      )}
      
      <SimpleSnackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={closeSnackbar}
        duration={5000}
      />
    </div>
  );
}

function TaskCard({ task, onStatusChange, isUpdating }) {
  const statusOptions = [
    { value: 'pending', label: 'Pending', icon: Clock },
    { value: 'approved', label: 'Approved', icon: CheckCircle },
    { value: 'rejected', label: 'Rejected', icon: XCircle },
    { value: 'implemented', label: 'Implemented', icon: CheckCircle },
  ];

  const currentStatus = statusOptions.find(s => s.value === task.status);
  const StatusIcon = currentStatus?.icon || Clock;

  return (
    <div className="task-card">
      <div className="task-header">
        <div className="task-status" title={currentStatus?.label}>
          <StatusIcon size={16} className={`status-icon ${task.status}`} />
          <span className={`status-label ${task.status}`}>{currentStatus?.label || task.status}</span>
        </div>
        <div className="task-confidence">
          {Math.round(task.confidence * 100)}% confidence
        </div>
      </div>
      <div className="task-content">
        <h3>{task.title || task.taskName || task.taskDescription}</h3>
        <p>{task.taskDescription}</p>
        <div className="task-meta">
          <span className="chip frequency-badge" title="Frequency">Freq: {task.frequencyScore ?? task.frequency}</span>
          <span className="chip difficulty-badge" title="Ease of Automation">Ease: {task.automationEaseScore ?? task.difficulty}</span>
          <span className="chip roi-badge" title="Priority/ROI">Priority: {task.priorityScore ?? task.estimatedRoi}</span>
          <span className="chip time-saved-badge" title="Estimated Time Saved">Time: {task.estimatedTimeSaved}</span>
        </div>
        <div className="task-steps">
          <strong>Manual Steps:</strong> <span>{task.currentManualSteps}</span>
        </div>
        <div className="task-approach">
          <strong>Suggested Automation:</strong> <span>{task.suggestedAutomationApproach}</span>
        </div>
        <div className="task-rationale">
          <strong>Rationale:</strong> <span>{task.rationale}</span>
        </div>
        {task.suggestedTools && task.suggestedTools.length > 0 && (
          <div className="task-tools">
            <h4>Suggested Tools:</h4>
            <div className="tools-list">
              {task.suggestedTools.map((tool, index) => (
                <span key={index} className="tool-tag chip" title={tool}>{tool}</span>
              ))}
            </div>
          </div>
        )}
        {/* <div className="task-source">
          <p>
            Found in: {task.slackConversation?.channelName || 'DM'}
            {task.slackConversation?.slackConnection?.slackTeamName && ` (${task.slackConversation?.slackConnection?.slackTeamName})`}
          </p>
        </div> */}
      </div>
      <div className="task-actions">
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
          disabled={isUpdating}
          className="modern-select"
          title="Change task status"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default Analysis; 