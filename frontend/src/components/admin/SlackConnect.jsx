import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { Slack, CheckCircle, XCircle, AlertCircle, Settings, RefreshCw, Unlink, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import ChannelSelector from '../common/ChannelSelector';
import { useAuth } from '../../contexts/AuthContext';
import SimpleSnackbar from '../common/SimpleSnackbar';
import './AdminSlackConnect.css';
import { ErrorBoundary } from 'react-error-boundary';
import { FixedSizeList as List } from 'react-window';
import { debounce } from 'lodash'; // Add lodash for debouncing

// Constants for pagination
const CONNECTIONS_PER_PAGE = 15;

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="error-container">
      <div className="error-content">
        <AlertCircle size={36} className="error-icon" />
        <h2>Something went wrong</h2>
        <p>{error.message || "An unexpected error occurred"}</p>
        <button onClick={resetErrorBoundary} className="retry-button">
          Try again
        </button>
      </div>
    </div>
  );
}

// Split into smaller components for better performance
const ConnectionTabs = ({ activeTab, setActiveTab }) => (
  <div className="tabs-container">
    <div className="tab-navigation">
      <button
        className={`tab-button ${activeTab === 'personal' ? 'active' : ''}`}
        onClick={() => setActiveTab('personal')}
      >
        My Connections
      </button>
      <button
        className={`tab-button ${activeTab === 'organization' ? 'active' : ''}`}
        onClick={() => setActiveTab('organization')}
      >
        All Organization Connections
      </button>
    </div>
  </div>
);

function AdminSlackConnect() {
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showChannelSelector, setShowChannelSelector] = useState(false);
  const queryClient = useQueryClient();
  const location = useLocation();
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const [activeTab, setActiveTab] = useState('personal'); // 'personal' or 'organization'
  const snackbarTimerRef = useRef(null);
  const [page, setPage] = useState(0); // Pagination state
  
  // Optimized effect to refetch data when navigating to this component
  // Using a more efficient query invalidation strategy
  useEffect(() => {
    // Get the current pathname
    const currentPath = location.pathname;
    
    // Only refetch if we navigate directly to this component
    if (currentPath === '/admin/slack' || currentPath === '/admin/slack/') {
      // Use a more selective invalidation strategy
      queryClient.invalidateQueries(['admin-connections', page], {
        refetchActive: true,
      });
    }
  }, [queryClient, location.pathname, page]);

  // Cleanup snackbar timer on unmount
  useEffect(() => {
    return () => {
      if (snackbarTimerRef.current) {
        clearTimeout(snackbarTimerRef.current);
      }
    };
  }, []);

  // Helper function to show snackbar with automatic cleanup
  const showSnackbarMessage = useCallback((message, type = 'success', duration = 3000) => {
    // Clear any existing timer
    if (snackbarTimerRef.current) {
      clearTimeout(snackbarTimerRef.current);
    }
    
    // Show the snackbar
    setSnackbar({
      isVisible: true,
      message,
      type
    });
    
    // Set the new timer
    snackbarTimerRef.current = setTimeout(() => {
      setSnackbar(prev => ({ ...prev, isVisible: false }));
      snackbarTimerRef.current = null;
    }, duration);
  }, []);

  // Fetch all connections (admin) with pagination
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery(
    ['admin-connections', page],
    async () => {
      const response = await axios.get('/api/slack/admin/connections', {
        params: {
          page,
          limit: CONNECTIONS_PER_PAGE
        }
      });
      return response.data;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 30000, // 30 seconds
      cacheTime: 300000, // 5 minutes
      refetchOnWindowFocus: false,
      keepPreviousData: true, // Keep previous data while loading new page
      onError: (err) => {
        console.error("Failed to load connections:", err);
        showSnackbarMessage('Failed to load Slack connections. Please try again.', 'error');
      }
    }
  );

  // Extract connections and total count
  const allConnections = connectionsData?.connections || [];
  const totalConnections = connectionsData?.totalCount || 0;
  const totalPages = Math.ceil(totalConnections / CONNECTIONS_PER_PAGE);

  // Fetch all users with more efficient caching
  const { data: allUsers, isLoading: usersLoading } = useQuery(
    'admin-users',
    async () => {
      const response = await axios.get('/api/slack/admin/users');
      return response.data.users;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 300000, // 5 minutes - user data changes less frequently
      cacheTime: 600000, // 10 minutes
      refetchOnWindowFocus: false,
      onError: (err) => {
        console.error("Failed to load users:", err);
        showSnackbarMessage('Failed to load user data. Please try again.', 'error');
      }
    }
  );

  // Get admin's personal connections with memoized dependency on user.id only
  const adminConnections = useMemo(() => {
    if (!allConnections || !user) return [];
    return allConnections.filter(conn => conn.userId === user.id);
  }, [allConnections, user?.id]); // Only depend on user.id, not the entire user object

  // Create a user map outside of the memo to avoid unnecessary recalculation
  const userMap = useMemo(() => {
    if (!allUsers || !Array.isArray(allUsers)) return {};
    
    const map = {};
    allUsers.forEach(user => {
      map[user.id] = user;
    });
    return map;
  }, [allUsers]);

  // Get all connections flattened for the table view with optimized lookup
  const flattenedConnections = useMemo(() => {
    if (!allConnections || !userMap) return [];
    
    return allConnections.map(conn => {
      const connUser = userMap[conn.userId]; // O(1) lookup
      return {
        ...conn,
        userName: connUser?.name || connUser?.email || 'Unknown User',
        userEmail: connUser?.email || 'No email',
        userRole: connUser?.role || 'user'
      };
    });
  }, [allConnections, userMap]); // Depend on userMap instead of allUsers

  // Handle OAuth callback result
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const team = urlParams.get('team');
    
    if (success || error) {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      if (success) {
        setIsConnecting(false);
        setShowAddWorkspace(false); // Hide add workspace interface on successful connection
        // Refresh connections
        queryClient.invalidateQueries(['admin-connections', page]);
        
        // Show success message
        const message = team 
          ? `Successfully connected to ${decodeURIComponent(team)}!`
          : 'Successfully connected to Slack!';
          
        showSnackbarMessage(message, 'success');
      } else if (error) {
        setIsConnecting(false);
        showSnackbarMessage(getErrorMessage(error), 'error');
      }
    }
  }, [queryClient, showSnackbarMessage, page]);

  const getErrorMessage = (error) => {
    switch (error) {
      case 'access_denied':
        return 'Access denied. Please approve the Slack app permissions to continue.';
      case 'invalid_code':
        return 'Invalid authorization code. Please try connecting again.';
      case 'code_already_used':
        return 'This authorization code has already been used. Please try connecting again.';
      case 'missing_parameters':
        return 'Missing required parameters. Please try connecting again.';
      case 'internal_error':
        return 'An internal error occurred. Please try again later.';
      case 'processing_failed':
        return 'Failed to process the Slack connection. Please try again.';
      case 'connection_not_found':
        return 'The Slack connection could not be found. It may have been deleted.';
      default:
        return 'Failed to connect to Slack. Please try again.';
    }
  };

  const connectSlack = useCallback(async () => {
    try {
      setIsConnecting(true);
      setSnackbar({ isVisible: false, message: '', type: 'success' });
      
      const response = await axios.get('/api/slack/auth');
      const { authUrl } = response.data;
      
      // Redirect to Slack OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error('Connect Slack error:', error);
      showSnackbarMessage('Failed to initiate Slack connection. Please try again.', 'error');
      setIsConnecting(false);
    }
  }, [showSnackbarMessage]);

  const disconnectMutation = useMutation(
    (connectionId) => axios.delete(`/api/slack/admin/connections/${connectionId}`),
    {
      onMutate: async (connectionId) => {
        // Cancel outgoing refetches
        await queryClient.cancelQueries(['admin-connections', page]);
        
        // Optimistic update
        const previousConnections = queryClient.getQueryData(['admin-connections', page]);
        
        if (previousConnections) {
          queryClient.setQueryData(['admin-connections', page], {
            ...previousConnections,
            connections: previousConnections.connections.filter(c => c.id !== connectionId),
            totalCount: previousConnections.totalCount - 1
          });
        }
        
        return { previousConnections };
      },
      onSuccess: (data, connectionId) => {
        // Invalidate related queries
        queryClient.invalidateQueries(['admin-connections', page]);
        queryClient.invalidateQueries(['connection-stats', connectionId]);
        showSnackbarMessage('Successfully disconnected from Slack.', 'success');
      },
      onError: (error, connectionId, context) => {
        // Revert optimistic update
        if (context?.previousConnections) {
          queryClient.setQueryData(['admin-connections', page], context.previousConnections);
        }
        
        console.error('Disconnect error:', error);
        showSnackbarMessage('Failed to disconnect from Slack. Please try again.', 'error');
      }
    }
  );

  const validateConnectionMutation = useMutation(
    (connectionId) => axios.post(`/api/slack/connections/${connectionId}/validate`),
    {
      onMutate: async (connectionId) => {
        // Cancel outgoing refetches for this query
        await queryClient.cancelQueries(['admin-connections', page]);
        
        // Snapshot previous connections data
        const previousConnections = queryClient.getQueryData(['admin-connections', page]);
        
        // Optimistically update connection status
        queryClient.setQueryData(['admin-connections', page], old => {
          if (!old) return old;
          return {
            ...old,
            connections: old.connections.map(conn => 
              conn.id === connectionId ? { ...conn, isValidating: true } : conn
            )
          };
        });
        
        return { previousConnections };
      },
      onSuccess: (data) => {
        queryClient.invalidateQueries(['admin-connections', page]);
        queryClient.invalidateQueries(['connection-stats', data.connectionId]);
        showSnackbarMessage('Connection validated successfully.', 'success');
      },
      onError: (error, connectionId, context) => {
        // Revert optimistic update
        queryClient.setQueryData(['admin-connections', page], context.previousConnections);
        console.error('Validation error:', error);
        showSnackbarMessage(
          error.response?.data?.message || 'Failed to validate connection. Please try again.',
          'error'
        );
      }
    }
  );

  const closeSnackbar = useCallback(() => {
    if (snackbarTimerRef.current) {
      clearTimeout(snackbarTimerRef.current);
      snackbarTimerRef.current = null;
    }
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  }, []);

  // Handler functions with useCallback
  const handleDisconnect = useCallback((id) => {
    disconnectMutation.mutate(id);
  }, [disconnectMutation]);

  const handleRefreshConnection = useCallback((id) => {
    validateConnectionMutation.mutate(id);
  }, [validateConnectionMutation]);

  const handleConfigureChannels = useCallback((connection, userId) => {
    setSelectedConnection(connection);
    setSelectedUserId(userId);
    setShowChannelSelector(true);
  }, []);

  // Handle pagination
  const handleNextPage = useCallback(() => {
    if (page < totalPages - 1) {
      setPage(page + 1);
    }
  }, [page, totalPages]);

  const handlePrevPage = useCallback(() => {
    if (page > 0) {
      setPage(page - 1);
    }
  }, [page]);

  // Render row for virtualized list - lowered threshold to 15 for virtualization
  const renderConnectionRow = useCallback(({ index, style }) => {
    const connection = flattenedConnections[index];
    return (
      <div style={style} key={connection.id}>
        <ConnectionTableRow
          connection={connection}
          onManageChannels={() => handleConfigureChannels(connection, connection.userId)}
          onRefresh={() => handleRefreshConnection(connection.id)}
          onDisconnect={() => handleDisconnect(connection.id)}
          isRefreshing={validateConnectionMutation.isLoading && 
            validateConnectionMutation.variables === connection.id}
          isDisconnecting={disconnectMutation.isLoading && 
            disconnectMutation.variables === connection.id}
          readOnly={true}
        />
      </div>
    );
  }, [
    flattenedConnections, 
    handleConfigureChannels, 
    handleRefreshConnection, 
    handleDisconnect, 
    validateConnectionMutation, 
    disconnectMutation
  ]);

  if ((connectionsLoading && page === 0) || usersLoading) {
    return (
      <div className="slack-connect-loading">
        <div className="loading-indicator">
          <div className="spinning"></div>
          <p>Loading connections and users...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => {
      queryClient.invalidateQueries(['admin-connections', page]);
      queryClient.invalidateQueries('admin-users');
    }}>
      <div className="slack-connect-container">
        {/* <div className="slack-connect-header">
          <h1>
            Slack Connections
          </h1>
        </div> */}

        {/* Show connection interface when adding a new workspace */}
        {showAddWorkspace && (
          <div className="connect-card add-workspace-card">
            <div className="connect-card-content">
              <div className="connect-icon-container">
                <Slack size={45} className="slack-icon" />
              </div>
              <h2>Connect New Slack Workspace</h2>
              <p>
                Connect a new Slack workspace to monitor communication and analyze collaboration patterns.
              </p>
              <div className="connect-actions">
                <button
                  onClick={connectSlack}
                  disabled={isConnecting}
                  className="connect-button"
                >
                  <Slack size={18} />
                  {isConnecting ? 'Connecting...' : 'Connect to Slack'}
                </button>
                <button
                  onClick={() => setShowAddWorkspace(false)}
                  className="cancel-button"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Show tabs when not adding another and not configuring channels */}
        {!showChannelSelector && !showAddWorkspace && (
          <>
            {/* Tab Navigation - Extracted into separate component */}
            <ConnectionTabs activeTab={activeTab} setActiveTab={setActiveTab} />
            
            {/* Personal Connections Tab */}
            {activeTab === 'personal' && (
              <div className="connections-section">
                <div className="connections-header">
                  <h2>My Slack Workspaces</h2>
                  <button
                    onClick={() => setShowAddWorkspace(true)}
                    className="welcome-cta-button"
                  >
                    <Slack size={16} />
                    Connect New Workspace
                  </button>
                </div>
                
                <div className="personal-connections-grid">
                  {adminConnections.length > 0 ? (
                    adminConnections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        onDisconnect={handleDisconnect}
                        onConfigureChannels={() => handleConfigureChannels(connection, user.id)}
                        onRefreshConnection={() => handleRefreshConnection(connection.id)}
                        isDisconnecting={disconnectMutation.isLoading && 
                          disconnectMutation.variables === connection.id}
                        isRefreshing={validateConnectionMutation.isLoading && 
                          validateConnectionMutation.variables === connection.id}
                        isAdminView={true}
                        queryClient={queryClient}
                      />
                    ))
                  ) : (
                    <div className="empty-configured-global">
                      <div className="empty-icon">
                        <Slack size={32} />
                      </div>
                      <p>You haven't connected any Slack workspaces yet.</p>
                      <button
                        onClick={() => setShowAddWorkspace(true)}
                        className="welcome-cta-button"
                      >
                        Connect Your First Workspace
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Organization Connections Tab - Table View with Virtualization - Lower threshold to 15 */}
            {activeTab === 'organization' && (
              <div className="connections-section">
                {flattenedConnections.length > 0 ? (
                  <div className="connections-table-wrapper">
                    {flattenedConnections.length > 15 ? (
                      <>
                        <List
                          height={Math.min(600, flattenedConnections.length * 60)}
                          itemCount={flattenedConnections.length}
                          itemSize={60}
                          width="100%"
                          className="virtual-connections-list"
                        >
                          {renderConnectionRow}
                        </List>
                        {/* Pagination controls */}
                        {totalPages > 1 && (
                          <div className="pagination-controls">
                            <button 
                              onClick={handlePrevPage} 
                              disabled={page === 0}
                              className="pagination-button"
                            >
                              Previous
                            </button>
                            <span className="pagination-info">
                              Page {page + 1} of {totalPages}
                            </span>
                            <button 
                              onClick={handleNextPage} 
                              disabled={page >= totalPages - 1}
                              className="pagination-button"
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <table className="connections-table">
                          <thead>
                            <tr>
                              <th>Status</th>
                              <th>Workspace</th>
                              <th>User</th>
                              <th>Connected On</th>
                            </tr>
                          </thead>
                          <tbody>
                            {flattenedConnections.map((connection) => (
                              <ConnectionTableRow
                                key={connection.id}
                                connection={connection}
                                onManageChannels={() => handleConfigureChannels(connection, connection.userId)}
                                onRefresh={() => handleRefreshConnection(connection.id)}
                                onDisconnect={() => handleDisconnect(connection.id)}
                                isRefreshing={validateConnectionMutation.isLoading && 
                                  validateConnectionMutation.variables === connection.id}
                                isDisconnecting={disconnectMutation.isLoading && 
                                  disconnectMutation.variables === connection.id}
                                readOnly={true}
                              />
                            ))}
                          </tbody>
                        </table>
                        {/* Pagination controls */}
                        {totalPages > 1 && (
                          <div className="pagination-controls">
                            <button 
                              onClick={handlePrevPage} 
                              disabled={page === 0}
                              className="pagination-button"
                            >
                              Previous
                            </button>
                            <span className="pagination-info">
                              Page {page + 1} of {totalPages}
                            </span>
                            <button 
                              onClick={handleNextPage} 
                              disabled={page >= totalPages - 1}
                              className="pagination-button"
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="empty-configured-global">
                    <div className="empty-icon">
                      <Slack size={32} />
                    </div>
                    <p>No Slack connections found across the organization.</p>
                    <button
                      onClick={() => setShowAddWorkspace(true)}
                      className="welcome-cta-button"
                    >
                      Connect Your First Workspace
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Channel Selector */}
        {showChannelSelector && selectedConnection && (
          <div className="channel-selector-section">
            <div className="channel-selector-header">
              <button 
                onClick={() => {
                  setShowChannelSelector(false);
                  setSelectedConnection(null);
                  setSelectedUserId(null);
                }}
                className="back-button"
              >
                ← Back to Connections
              </button>
              
              <div className="selector-title">
                <Slack className="slack-icon" size={20} />
                <h2>{selectedConnection.slackTeamName}</h2>
              </div>
              <p className="selector-subtitle">
                Managing connection for user: {
                  userMap[selectedUserId]?.name || 
                  userMap[selectedUserId]?.email || 
                  'Unknown User'
                }
              </p>
            </div>
            
            <ChannelSelector 
              connection={selectedConnection}
              isAdminMode={true}
              userId={selectedUserId}
              onScrapeComplete={(data) => {
                showSnackbarMessage(`Started analyzing ${data.totalSelected} conversations!`, 'success', 5000);
                // Invalidate related queries to refresh data
                queryClient.invalidateQueries(['connection-stats', selectedConnection.id]);
              }}
              onError={(error) => {
                console.error("Channel selector error:", error);
                showSnackbarMessage(
                  error.message || 'Failed to load channels. The connection may be invalid.',
                  'error'
                );
                
                // If connection is not found, go back to the connections list
                if (error.status === 404) {
                  setTimeout(() => {
                    setShowChannelSelector(false);
                    setSelectedConnection(null);
                    setSelectedUserId(null);
                    // Refresh connections list
                    queryClient.invalidateQueries(['admin-connections', page]);
                  }, 3000);
                }
              }}
            />
          </div>
        )}
        
        <SimpleSnackbar
          message={snackbar.message}
          type={snackbar.type}
          isVisible={snackbar.isVisible}
          onClose={closeSnackbar}
        />
      </div>
    </ErrorBoundary>
  );
}

// Memoized table row component for better performance
const ConnectionTableRow = React.memo(function ConnectionTableRow({ 
  connection, 
  onManageChannels, 
  onRefresh, 
  onDisconnect, 
  isRefreshing, 
  isDisconnecting,
  readOnly = false
}) {
  return (
    <tr>
      <td>
        <div className="table-status">
          {connection.isActive ? (
            <span className="status-icon active">
              <CheckCircle size={14} />
            </span>
          ) : (
            <span className="status-icon inactive">
              <XCircle size={14} />
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="table-workspace">
          <span className="workspace-name">{connection.slackTeamName}</span>
        </div>
      </td>
      <td>
        <div className="table-user">
          <div className="user-info-compact">
            <span className="user-name">{connection.userName}</span>
            <span className="user-email">{connection.userEmail}</span>
          </div>
        </div>
      </td>
      <td>
        <div className="table-date">
          {new Date(connection.createdAt).toLocaleDateString()}
        </div>
      </td>
      {!readOnly && (
        <td>
          <div className="table-actions">
            <button
              onClick={onManageChannels}
              className="table-action-button configure"
              title="Manage channels"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="table-action-button refresh"
              title="Refresh connection"
            >
              {isRefreshing ? 
                <Loader size={14} className="spinning" /> : 
                <RefreshCw size={14} />
              }
            </button>
            <button
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="table-action-button disconnect"
              title="Disconnect workspace"
            >
              <Unlink size={14} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
});

// Memoize ConnectionCard to prevent unnecessary re-renders
const ConnectionCard = React.memo(function ConnectionCard({ 
  connection, 
  onDisconnect, 
  onConfigureChannels, 
  onRefreshConnection, 
  isDisconnecting, 
  isRefreshing, 
  isAdminView,
  queryClient
}) {
  // Memoized handlers to prevent unnecessary re-renders
  const handleDisconnect = useCallback(() => {
    onDisconnect(connection.id);
  }, [onDisconnect, connection.id]);
  
  const handleConfigureChannels = useCallback(() => {
    onConfigureChannels(connection);
  }, [onConfigureChannels, connection]);
  
  const handleRefresh = useCallback(() => {
    onRefreshConnection(connection.id);
  }, [onRefreshConnection, connection.id]);

  return (
    <div className="connection-card">
      <div className="connection-card-body">
        <div className="connection-header">
          <div className="connection-info">
            {connection.isActive ? (
              <span className="status-icon active">
                <CheckCircle size={14} />
              </span>
            ) : (
              <span className="status-icon inactive">
                <XCircle size={14} />
              </span>
            )}
            <div className="connection-details">
              <h3>{connection.slackTeamName}</h3>
              <p className="connection-date">
                Connected {new Date(connection.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="disconnect-button"
            title="Disconnect this workspace"
          >
            <Unlink size={16} />
          </button>
        </div>

        <div className="connection-actions">
          <button
            onClick={handleConfigureChannels}
            className="configure-channels-button"
          >
            <Settings size={14} />
            {isAdminView ? 'Manage Channels' : 'Configure Channels'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="refresh-connection-button"
          >
            {isRefreshing ? <Loader size={14} className="spinning" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
});

export default AdminSlackConnect; 