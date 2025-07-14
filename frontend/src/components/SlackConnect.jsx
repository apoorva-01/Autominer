import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { Link, Slack, CheckCircle, XCircle, AlertCircle, Settings, ArrowRight } from 'lucide-react';
import ChannelSelector from './ChannelSelector';
import { useAuth } from '../contexts/AuthContext';

function SlackConnect() {
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [showChannelSelector, setShowChannelSelector] = useState(false);
  const queryClient = useQueryClient();
  const callbackProcessedRef = useRef(false);
  const [googleDocsStatus, setGoogleDocsStatus] = useState(null);
  const [scrapingJobs, setScrapingJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);

  // Fetch existing connections
  const { data: existingConnections, isLoading } = useQuery(
    'slack-connections',
    async () => {
      const response = await axios.get('/api/slack/connections');
      return response.data.connections;
    }
  );

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
        setError(null);
        setIsConnecting(false);
        setShowAddWorkspace(false); // Hide add workspace interface on successful connection
        // Refresh connections
        queryClient.invalidateQueries('slack-connections');
        
        // Show success message
        if (team) {
          setSuccess(`Successfully connected to ${decodeURIComponent(team)}!`);
        } else {
          setSuccess('Successfully connected to Slack!');
        }
        
        // Clear success message after 3 seconds
        setTimeout(() => {
          setSuccess(null);
        }, 3000);
      } else if (error) {
        setIsConnecting(false);
        setSuccess(null);
        const errorMessage = getErrorMessage(error);
        setError(errorMessage);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    fetchGoogleDocsStatus();
  }, []);



  const fetchGoogleDocsStatus = async () => {
    try {
      const response = await axios.get('/api/slack/google-docs/status');
      setGoogleDocsStatus(response.data);
    } catch (error) {
      console.warn('Failed to fetch Google Docs status:', error);
    }
  };

  const renderGoogleDocsStatus = () => {
    if (!googleDocsStatus) return null;

    const getStatusColor = (status) => {
      switch (status) {
        case 'ready': return 'text-green-600';
        case 'error': return 'text-red-600';
        case 'not_configured': return 'text-gray-600';
        default: return 'text-gray-600';
      }
    };

    const getStatusText = (status) => {
      switch (status) {
        case 'ready': return 'Ready';
        case 'error': return 'Error - Check Configuration';
        case 'not_configured': return 'Not Configured';
        default: return 'Unknown';
      }
    };

    return (
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-6">
        <h3 className="font-semibold text-blue-900 mb-2 flex items-center">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Google Docs Integration
        </h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span>Status:</span>
            <span className={`font-semibold ${getStatusColor(googleDocsStatus.status)}`}>
              {getStatusText(googleDocsStatus.status)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Root Folder:</span>
            <span className="font-mono text-sm">{googleDocsStatus.rootFolderName}</span>
          </div>
          {googleDocsStatus.status === 'ready' && (
            <div className="flex items-center text-green-600">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm">Messages will be saved to Google Docs automatically</span>
            </div>
          )}
          {googleDocsStatus.status === 'not_configured' && (
            <div className="text-sm text-gray-600">
              Configure Google API credentials in backend environment to enable Google Docs integration
            </div>
          )}
        </div>
      </div>
    );
  };

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

  const connectSlack = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setSuccess(null);
      
      const response = await axios.get('/api/slack/auth');
      const { authUrl } = response.data;
      
      // Redirect to Slack OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error('Connect Slack error:', error);
      setError('Failed to initiate Slack connection. Please try again.');
      setIsConnecting(false);
    }
  };

  const disconnectMutation = useMutation(
    (connectionId) => axios.delete(`/api/slack/connections/${connectionId}`),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('slack-connections');
        setSuccess('Successfully disconnected from Slack.');
        setTimeout(() => {
          setSuccess(null);
        }, 3000);
      },
      onError: (error) => {
        console.error('Disconnect error:', error);
        setError('Failed to disconnect from Slack. Please try again.');
      }
    }
  );

  if (isLoading) {
    return (
      <div className="slack-connect-container">
        <div className="loading">Loading connections...</div>
      </div>
    );
  }

  return (
    <div className="slack-connect-container">
      <div className="slack-connect-header">
        <h1>Slack Connections</h1>
        <p>Connect your Slack workspace to analyze conversations for automation opportunities.</p>
      </div>

      {error && (
        <div className="error-message">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {success && (
        <div className="success-message">
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      {isConnecting && (
        <div className="connecting-message">
          <div className="spinner"></div>
          Connecting to Slack...
        </div>
      )}

      {/* Show connection interface when no connections exist OR when adding another workspace */}
      {((existingConnections && existingConnections.length === 0) || showAddWorkspace) && (
        <div className="connect-section">
          <div className="connect-card">
            <div className="connect-icon">
              <Slack size={48} />
            </div>
            <h2>Connect Your Slack Workspace</h2>
            <p>
              Grant access to your Slack conversations so we can analyze them for 
              repetitive tasks and automation opportunities.
            </p>
            <div className="permissions-info">
              <h3>We'll need permission to:</h3>
              <ul>
                <li>Read channel history</li>
                <li>Read direct messages</li>
                <li>Read user information</li>
                <li>Read team information</li>
              </ul>
            </div>
            <div className="connect-actions">
              <button
                onClick={connectSlack}
                disabled={isConnecting}
                className="connect-button"
              >
                <Slack size={20} />
                {isConnecting ? 'Connecting...' : 'Connect to Slack'}
              </button>
              {/* Show cancel button when adding another workspace */}
              {showAddWorkspace && existingConnections && existingConnections.length > 0 && (
                <button
                  onClick={() => setShowAddWorkspace(false)}
                  className="cancel-button"
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
            {/* <h2>Connected Workspaces</h2> */}
            <button
              onClick={() => setShowAddWorkspace(true)}
              className="add-workspace-button"
            >
              <Slack size={16} />
              Add Another Workspace
            </button>
          </div>
          <div className="connections-grid">
            {existingConnections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onDisconnect={(id) => disconnectMutation.mutate(id)}
                onConfigureChannels={(connection) => {
                  setSelectedConnection(connection);
                  setShowChannelSelector(true);
                }}
                onRefreshConnection={connectSlack}
                isDisconnecting={disconnectMutation.isLoading}
              />
            ))}
          </div>
        </div>
      )}

      {/* {renderGoogleDocsStatus()} */}

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
            <h2>{selectedConnection.slackTeamName}</h2>
          </div>
          
          <ChannelSelector 
            connection={selectedConnection}
            onScrapeComplete={(data) => {
              setSuccess(`Started analyzing ${data.totalSelected} conversations!`);
              setTimeout(() => setSuccess(null), 5000);
            }}
          />
        </div>
      )}

      <div className="info-section">
        <h2>What happens next?</h2>
        <div className="info-steps">
          <div className="info-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <h3>Data Collection</h3>
              <p>We'll automatically collect conversations from your connected Slack workspace.</p>
            </div>
          </div>
          <div className="info-step">
            <div className="step-number">2</div>
            <div className="step-content">
              <h3>AI Analysis</h3>
              <p>Our AI analyzes conversations to identify repetitive tasks and automation opportunities.</p>
            </div>
          </div>
          <div className="info-step">
            <div className="step-number">3</div>
            <div className="step-content">
              <h3>Automation Reports</h3>
              <p>Receive weekly reports with actionable automation suggestions ranked by ROI.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({ connection, onDisconnect, onConfigureChannels, onRefreshConnection, isDisconnecting }) {
  const [showStats, setShowStats] = useState(false);

  const { data: stats } = useQuery(
    ['connection-stats', connection.id],
    async () => {
      const response = await axios.get(`/api/slack/connections/${connection.id}/stats`);
      return response.data;
    },
    {
      enabled: showStats
    }
  );

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
          onClick={() => onDisconnect(connection.id)}
          disabled={isDisconnecting}
          className="disconnect-button"
        >
          {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>

      {/* <div className="connection-scopes">
        <h4>Permissions:</h4>
        <div className="scopes-list">
          {connection.scopes.map((scope) => (
            <span key={scope} className="scope-tag">
              {scope}
            </span>
          ))}
        </div>
      </div> */}

      <div className="connection-actions">
        <button
          onClick={() => onConfigureChannels(connection)}
          className="configure-channels-button"
        >
          <Settings size={16} />
          Configure Channels
        </button>
                  <button
            onClick={onRefreshConnection}
            className="refresh-connection-button"
          >
            <ArrowRight size={16} />
            Refresh Connection
          </button>
        <button
          onClick={() => setShowStats(!showStats)}
          className="stats-button"
        >
          {showStats ? 'Hide Stats' : 'Show Stats'}
        </button>
      </div>

      {showStats && stats && (
        <div className="connection-stats">
          <div className="stat-item">
            <span className="stat-label">Total Messages:</span>
            <span className="stat-value">{stats.totalMessages}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Last Message:</span>
            <span className="stat-value">
              {stats.lastMessageAt 
                ? new Date(stats.lastMessageAt).toLocaleDateString()
                : 'No messages yet'
              }
            </span>
          </div>
          <div className="message-types">
            <h5>Message Types:</h5>
            {stats.messageTypes.map((type) => (
              <div key={type.messageType} className="message-type-stat">
                <span>{type.messageType}:</span>
                <span>{type._count.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SlackConnect; 