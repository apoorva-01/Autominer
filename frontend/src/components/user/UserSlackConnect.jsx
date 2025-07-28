import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { CheckCircle, XCircle, Settings, RefreshCw, Unlink } from 'lucide-react';
import ChannelSelector from '../common/ChannelSelector';
import { useAuth } from '../../contexts/AuthContext';
import SimpleSnackbar from '../common/SimpleSnackbar';
import { FixedSizeList as List } from 'react-window';
import { debounce } from 'lodash'; // Add lodash for debouncing

// Slack SVG component
const SlackIcon = ({ size = 24, className = "" }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 122.8 122.8" 
    width={size} 
    height={size} 
    className={`slack-icon ${className}`}
  >
    <path 
      d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" 
      fill="#E01E5A"
    />
    <path 
      d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" 
      fill="#36C5F0"
    />
    <path 
      d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" 
      fill="#2EB67D"
    />
    <path 
      d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" 
      fill="#ECB22E"
    />
  </svg>
);

// Official Slack Add to Slack button component
const AddToSlackButton = ({ onClick, disabled, isLoading }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="add-to-slack-button"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Lato, sans-serif',
      fontWeight: 'bold',
      fontSize: '16px',
      color: '#4A4A4A',
      border: 'none',
      backgroundColor: 'white',
      padding: '12px 24px',
      minWidth: '200px',
      cursor: disabled ? 'default' : 'pointer',
      textDecoration: 'none',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
      transition: 'all 0.2s ease'
    }}
  >
    <SlackIcon size={54} style={{ marginRight: '12px' }} />
    {isLoading ? 'Connecting...' : 'Add to Slack'}
  </button>
);

// Constants for pagination
const CONNECTIONS_PER_PAGE = 10;

function UserSlackConnect() {
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [showChannelSelector, setShowChannelSelector] = useState(false);
  const queryClient = useQueryClient();
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const snackbarTimerRef = useRef(null);
  const [page, setPage] = useState(0); // Add pagination state

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

  // Cleanup snackbar timer on unmount
  useEffect(() => {
    return () => {
      if (snackbarTimerRef.current) {
        clearTimeout(snackbarTimerRef.current);
      }
    };
  }, []);

  // Fetch user's connections with pagination
  const { data: connectionsData, isLoading } = useQuery(
    ['user-connections', page],
    async () => {
      const response = await axios.get('/api/slack/user/connections', {
        params: {
          page,
          limit: CONNECTIONS_PER_PAGE
        }
      });
      return response.data;
    },
    {
      staleTime: 60000, // 1 minute
      cacheTime: 300000, // 5 minutes
      refetchOnWindowFocus: false,
      keepPreviousData: true, // Keep previous data while loading new page
      onError: (err) => {
        console.error("Failed to load connections:", err);
        showSnackbarMessage('Failed to load connections. Please try again.', 'error');
      }
    }
  );

  // Extract connections and total count
  const existingConnections = connectionsData?.connections || [];
  const totalConnections = connectionsData?.totalCount || 0;
  const totalPages = Math.ceil(totalConnections / CONNECTIONS_PER_PAGE);

  // Handle OAuth callback result with proper cleanup
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
        queryClient.invalidateQueries('user-connections');
        
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
  }, [queryClient, showSnackbarMessage]);

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

  // Fixed disconnectMutation with proper cleanup and optimistic updates
  const disconnectMutation = useMutation(
    (connectionId) => axios.delete(`/api/slack/user/connections/${connectionId}`),
    {
      onMutate: async (connectionId) => {
        // Cancel outgoing refetches
        await queryClient.cancelQueries('user-connections');
        
        // Optimistic update
        const previousConnections = queryClient.getQueryData(['user-connections', page]);
        
        if (previousConnections) {
          queryClient.setQueryData(['user-connections', page], {
            ...previousConnections,
            connections: previousConnections.connections.filter(c => c.id !== connectionId),
            totalCount: previousConnections.totalCount - 1
          });
        }
        
        return { previousConnections };
      },
      onSuccess: (data, connectionId) => {
        // Invalidate related queries
        queryClient.invalidateQueries('user-connections');
        queryClient.invalidateQueries(['connection-stats', connectionId]);
        showSnackbarMessage('Successfully disconnected from Slack.', 'success');
      },
      onError: (error, connectionId, context) => {
        // Revert optimistic update
        if (context?.previousConnections) {
          queryClient.setQueryData(['user-connections', page], context.previousConnections);
        }
        
        console.error('Disconnect error:', error);
        showSnackbarMessage('Failed to disconnect from Slack. Please try again.', 'error');
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

  // Handle disconnection with useCallback
  const handleDisconnect = useCallback((id) => {
    disconnectMutation.mutate(id);
  }, [disconnectMutation]);

  // Handle channel configuration with useCallback
  const handleConfigureChannels = useCallback((connection) => {
    setSelectedConnection(connection);
    setShowChannelSelector(true);
  }, []);

  // Render row for virtualized list
  const renderConnectionRow = useCallback(({ index, style }) => {
    const connection = existingConnections[index];
    return (
      <div style={style} key={connection.id}>
        <ConnectionCard
          connection={connection}
          onDisconnect={handleDisconnect}
          onConfigureChannels={handleConfigureChannels}
          onRefreshConnection={connectSlack}
          isDisconnecting={disconnectMutation.isLoading && 
            disconnectMutation.variables === connection.id}
          queryClient={queryClient}
        />
      </div>
    );
  }, [existingConnections, handleDisconnect, handleConfigureChannels, connectSlack, disconnectMutation, queryClient]);

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

  if (isLoading && page === 0) { // Only show loading on initial load
    return (
      <div className="slack-connect-container user-slack-connect">
        <div className="loading">Loading connections...</div>
      </div>
    );
  }

  return (
    <div className="slack-connect-container user-slack-connect">
      {/* Show connection interface when no connections exist OR when adding another workspace */}
      {((existingConnections && existingConnections.length === 0 && totalConnections === 0) || showAddWorkspace) && (
        <div className="connect-section">
          <div className="connect-card" style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '32px',
            maxWidth: '500px',
            margin: '0 auto',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            border: 'none',
            textAlign: 'center'
          }}>
            <h2 style={{ 
              fontSize: '24px', 
              fontWeight: '700', 
              color: '#1D1C1D',
              marginBottom: '16px'
            }}>Connect Your Slack Workspace</h2>
            <p style={{ 
              fontSize: '16px', 
              color: '#616061',
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              Grant access to your Slack conversations so we can analyze them for 
              repetitive tasks and automation opportunities.
            </p>
            <div className="permissions-info" style={{
              backgroundColor: '#F8F8F8',
              padding: '16px',
              borderRadius: '4px',
              marginBottom: '24px',
              textAlign: 'left'
            }}>
              <h3 style={{ 
                fontSize: '16px',
                color: '#1D1C1D',
                marginBottom: '8px',
                fontWeight: '600'
              }}>We'll need permission to:</h3>
              <ul style={{
                listStyleType: 'none',
                padding: '0',
                margin: '0'
              }}>
                {['Read channel history', 'Read direct messages', 'Read user information', 'Read team information'].map(item => (
                  <li key={item} style={{
                    display: 'flex',
                    alignItems: 'center',
                    margin: '8px 0',
                    fontSize: '14px',
                    color: '#616061'
                  }}>
                    <CheckCircle size={16} style={{ color: '#2EB67D', marginRight: '8px' }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="connect-actions" style={{ marginTop: '24px' }}>
              <AddToSlackButton 
                onClick={connectSlack}
                disabled={isConnecting}
                isLoading={isConnecting}
              />
              {/* Show cancel button when adding another workspace */}
              {showAddWorkspace && existingConnections && existingConnections.length > 0 && (
                <button
                  onClick={() => setShowAddWorkspace(false)}
                  className="cancel-button"
                  style={{
                    marginTop: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: '#1264A3',
                    cursor: 'pointer',
                    fontSize: '14px',
                    textDecoration: 'underline'
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Show connected workspaces when they exist and not adding another */}
      {existingConnections && existingConnections.length > 0 && !showChannelSelector && !showAddWorkspace && (
        <div className="connections-section">
          <div className="connections-header">
            <button
              onClick={() => setShowAddWorkspace(true)}
              className="add-workspace-button"
            >
              <SlackIcon size={16} />
              Add Another Workspace
            </button>
          </div>
          
          {/* Use virtualization for large lists */}
          <div className="connections-grid">
            {existingConnections.length > 20 ? (
              <List
                height={Math.min(600, existingConnections.length * 150)}
                itemCount={existingConnections.length}
                itemSize={150}
                width="100%"
                className="virtual-connections-list"
              >
                {renderConnectionRow}
              </List>
            ) : (
              existingConnections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  onDisconnect={handleDisconnect}
                  onConfigureChannels={handleConfigureChannels}
                  onRefreshConnection={connectSlack}
                  isDisconnecting={disconnectMutation.isLoading && 
                    disconnectMutation.variables === connection.id}
                  queryClient={queryClient}
                />
              ))
            )}
          </div>
          
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
        </div>
      )}

      {/* Channel Selector */}
      {showChannelSelector && selectedConnection && (
        <div className="channel-selector-section">
          <div className="channel-selector-header">
            <button 
              onClick={() => setShowChannelSelector(false)}
              className="back-button"
            >
              ← Back to Connections
            </button>
          </div>
          
          <ChannelSelector 
            connection={selectedConnection}
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
                  // Refresh connections list
                  queryClient.invalidateQueries('user-connections');
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
  );
}

// Memoize the ConnectionCard to prevent unnecessary re-renders
const ConnectionCard = React.memo(function ConnectionCard({ 
  connection, 
  onDisconnect, 
  onConfigureChannels, 
  onRefreshConnection, 
  isDisconnecting,
  queryClient
}) {
  // Memoized handlers for better performance
  const handleDisconnect = useCallback(() => {
    onDisconnect(connection.id);
  }, [onDisconnect, connection.id]);
  
  const handleConfigureChannels = useCallback(() => {
    onConfigureChannels(connection);
  }, [onConfigureChannels, connection]);

  return (
    <div className="connection-card">
      <div className="connection-header">
        <div className="connection-info">
          <div className="connection-status">
            {connection.isActive ? (
              <CheckCircle className="status-icon active" size={16} />
            ) : (
              <XCircle className="status-icon inactive" size={16} />
            )}
          </div>
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
        >
          <Unlink size={16} />
          {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>

      <div className="connection-actions">
        <button
          onClick={handleConfigureChannels}
          className="configure-channels-button"
        >
          <Settings size={16} />
          Configure Channels
        </button>
        <button
          onClick={onRefreshConnection}
          className="refresh-connection-button"
        >
          <RefreshCw size={16} />
          Refresh Connection
        </button>
      </div>
    </div>
  );
});

export default UserSlackConnect; 