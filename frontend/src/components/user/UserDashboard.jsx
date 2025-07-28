import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  Slack,
  Plus,
  Loader,
  Hash,
  User,
  Bot,
  Sparkles,
  Settings,
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import SimpleSnackbar from '../common/SimpleSnackbar';

// Extracted ChannelItem component for better list rendering performance
const ChannelItem = React.memo(({ id, name, Icon }) => (
  <div className="channel-list-item" title={name || id}>
    <Icon size={14} className="tag-icon" />
    <span className="channel-name">{name || id}</span>
  </div>
));

// Extracted ChannelsList component with windowing optimization for large lists
const ChannelsList = React.memo(({ channels, channelMap, Icon, type }) => {
  // Add state to track if the list is expanded
  const [expanded, setExpanded] = useState(false);
  // Only render first 20 items for better performance, add "View more" if needed
  const isLargeList = channels.length > 20;
  const displayedChannels = isLargeList && !expanded ? channels.slice(0, 20) : channels;

  const handleViewMore = useCallback((e) => {
    e.stopPropagation();
    setExpanded(true);
  }, []);

  const handleViewLess = useCallback((e) => {
    e.stopPropagation();
    setExpanded(false);
  }, []);
  
  return (
    <div className={`${type}-list-ui`}>
      <div className="list-title">
        <Icon size={16} className="pulse-on-hover" />
        <span>{type === 'channels' ? 'Channels' : 'Direct Messages'}</span>
        <span className="count-badge">{channels.length}</span>
      </div>
      <div className={`${type}-tag-container`}>
        {displayedChannels.map((ch) => (
          <ChannelItem 
            key={ch} 
            id={ch} 
            name={channelMap[ch]} 
            Icon={Icon} 
          />
        ))}
        {isLargeList && !expanded && (
          <div className="view-more-item" onClick={handleViewMore} style={{ cursor: 'pointer' }}>
            <span>+{channels.length - 20} more</span>
          </div>
        )}
        {isLargeList && expanded && (
          <div className="view-more-item" onClick={handleViewLess} style={{ cursor: 'pointer' }}>
            <span>View less</span>
          </div>
        )}
      </div>
    </div>
  );
});

// Extracted WorkspaceCard component for better memoization
const WorkspaceCard = React.memo(({ 
  connection, 
  savedChannelsData, 
  channelsInfoData, 
  isLoading, 
  isExpanded, 
  onToggleExpand 
}) => {
  // Process data outside of render when possible
  const channelMap = useMemo(() => {
    if (!channelsInfoData?.channels) return {};
    return channelsInfoData.channels.reduce((acc, ch) => { 
      acc[ch.id] = ch.name; 
      return acc; 
    }, {});
  }, [channelsInfoData?.channels]);
  
  const dmMap = useMemo(() => {
    if (!channelsInfoData?.dms) return {};
    return channelsInfoData.dms.reduce((acc, dm) => { 
      acc[dm.id] = dm.name; 
      return acc; 
    }, {});
  }, [channelsInfoData?.dms]);
  
  const totalConfigured = useMemo(() => {
    if (!savedChannelsData) return 0;
    return (savedChannelsData.selectedChannels?.length || 0) + 
           (savedChannelsData.selectedDMs?.length || 0);
  }, [savedChannelsData]);

  const handleClick = useCallback(() => {
    onToggleExpand(connection.id);
  }, [connection.id, onToggleExpand]);

  const handleStopPropagation = useCallback((e) => {
    e.stopPropagation();
  }, []);

  const configureLink = useMemo(() => (
    `/slack-connect/${connection.id}/configure`
  ), [connection.id]);

  return (
    <div 
      className={`configured-workspace-card ${isExpanded ? 'expanded' : ''}`}
      onClick={handleClick}
    >
      <div className="workspace-header">
        <div className="workspace-title-section">
          <div className="workspace-icon">
            <Slack size={24} />
          </div>
          <div className="workspace-info">
            <h3 className="workspace-title">{connection.slackTeamName}</h3>
          </div>
        </div>
      </div>
      
      {isLoading ? (
        <div className="loading-configured">
          <Loader size={16} className="spinning" /> 
          <span>Loading configured channels and DMs...</span>
        </div>
      ) : savedChannelsData && (savedChannelsData.selectedChannels.length > 0 || savedChannelsData.selectedDMs.length > 0) ? (
        <div className="channels-dms-lists">
          {savedChannelsData.selectedChannels.length > 0 && (
            <ChannelsList
              channels={savedChannelsData.selectedChannels}
              channelMap={channelMap}
              Icon={Hash}
              type="channels"
            />
          )}
          
          {savedChannelsData.selectedDMs.length > 0 && (
            <ChannelsList
              channels={savedChannelsData.selectedDMs}
              channelMap={dmMap}
              Icon={User}
              type="dms"
            />
          )}
        </div>
      ) : (
        <div className="empty-configured">
          <AlertCircle size={18} />
          <span>No channels or DMs configured for this workspace.</span>
          <Link 
            to={configureLink} 
            className="configure-now-link" 
            onClick={handleStopPropagation}
          >
            <span>Configure now</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </div>
  );
});

// Extracted WelcomeSection component
const WelcomeSection = React.memo(() => (
  <div className="welcome-section">
    <div className="welcome-card">
      <div className="welcome-card-content">
        <h2 className="welcome-title">Welcome!</h2>
        <p className="welcome-message">
          Connect your Slack workspace to begin discovering automation opportunities from your team conversations.
        </p>
        <div className="welcome-illustration">
          <Bot size={48} className="bot-icon" />
          <Slack size={48} className="slack-icon" />
        </div>
        <Link to="/slack-connect" className="welcome-cta-button">
          <Plus size={18} />
          Connect Slack Workspace
        </Link>
      </div>
    </div>
  </div>
));

// Extracted EmptyConfigured component
const EmptyConfigured = React.memo(() => (
  <div className="empty-configured-global">
    <div className="empty-icon-container">
      <img 
        src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4ac.png" 
        alt="No channels"
        width="72"
        height="72"
        loading="lazy"
      />
      <Sparkles className="sparkle-icon" size={20} />
    </div>
    <div className="empty-content">
      <h3>No channels or DMs configured</h3>
      <p>Configure your first channel to start monitoring messages</p>
      <Link to="/slack-connect" className="get-started-btn">
        <Settings size={16} />
        <span>Configure Channels</span>
      </Link>
    </div>
  </div>
));

// Extracted SnackbarComponent to prevent re-renders of main component
const SnackbarComponent = React.memo(({ snackbar, onClose }) => (
  <SimpleSnackbar
    message={snackbar.message}
    type={snackbar.type}
    isVisible={snackbar.isVisible}
    onClose={onClose}
  />
));

// Main component wrapped in memo for optimal rendering
const UserDashboard = React.memo(function UserDashboard() {
  const { user } = useAuth();
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const [expandedWorkspace, setExpandedWorkspace] = useState(null);

  const handleSnackbarClose = useCallback(() => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  }, []);

  // Fetch user connections with proper caching strategy
  const { 
    data: connections, 
    isLoading: connectionsLoading, 
    error: connectionsError 
  } = useQuery(
    'user-connections',
    async () => {
      const response = await axios.get('/api/slack/user/connections');
      return response.data.connections;
    },
    {
      staleTime: 60000, // 1 minute
      retry: 2,
      onError: (error) => {
        setSnackbar({ 
          isVisible: true, 
          message: 'Failed to load connections: ' + (error.response?.data?.message || error.message), 
          type: 'error' 
        });
      }
    }
  );

  // Get connection IDs for batch fetching
  const connectionIds = useMemo(() => (connections || []).map(conn => conn.id), [connections]);

  // REPLACED: Individual queries with a single batched query
  const {
    data: batchedData,
    isLoading: batchedDataLoading,
    error: batchedDataError
  } = useQuery(
    ['workspace-batch-data', connectionIds],
    async () => {
      // Skip if there are no connections
      if (!connectionIds.length) return { savedChannels: {}, channelsInfo: {} };
      
      const response = await axios.post('/api/slack/batch-data', {
        connectionIds
      });
      return response.data;
    },
    {
      enabled: connectionIds.length > 0,
      staleTime: 300000, // 5 minutes
      retry: 2,
      onError: (error) => {
        setSnackbar({
          isVisible: true,
          message: 'Failed to load workspace data: ' + (error.response?.data?.message || error.message),
          type: 'error'
        });
      }
    }
  );

  // Memoize toggle handler to prevent recreation on each render
  const handleToggleExpand = useCallback((connectionId) => {
    setExpandedWorkspace(prev => prev === connectionId ? null : connectionId);
  }, []);

  // Memoize the check if all workspaces have empty configuration
  const allWorkspacesEmpty = useMemo(() => {
    // Early return if no connections or no data
    if (!connections || connections.length === 0 || !batchedData) return true;
    
    // Short-circuit optimization: check for any non-empty workspace
    return !connections.some(conn => {
      const savedChannels = batchedData.savedChannels?.[conn.id];
      return savedChannels && (
        savedChannels.selectedChannels.length > 0 || 
        savedChannels.selectedDMs.length > 0
      );
    });
  }, [connections, batchedData]);

  // Memoize the workspace cards to prevent unnecessary re-renders
  const workspaceCards = useMemo(() => {
    if (!connections) return null;
    
    return connections.map((connection) => (
      <WorkspaceCard 
        key={connection.id}
        connection={connection}
        savedChannelsData={batchedData?.savedChannels?.[connection.id]}
        channelsInfoData={batchedData?.channelsInfo?.[connection.id]}
        isLoading={batchedDataLoading}
        isExpanded={expandedWorkspace === connection.id}
        onToggleExpand={handleToggleExpand}
      />
    ));
  }, [connections, batchedData, batchedDataLoading, expandedWorkspace, handleToggleExpand]);

  const isLoading = connectionsLoading || (connectionIds.length > 0 && batchedDataLoading);
  const hasError = connectionsError || batchedDataError;

  if (isLoading) {
    return (
      <div className="dashboard user-dashboard">
        <div className="loading">
          <Loader size={24} className="spinning" />
          <span>Loading your workspaces...</span>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="dashboard user-dashboard">
        <div className="error-state">
          <AlertCircle size={24} />
          <p>Error loading workspaces. Please try again later.</p>
        </div>
        <SnackbarComponent
          snackbar={snackbar}
          onClose={handleSnackbarClose}
        />
      </div>
    );
  }

  return (
    <div className="dashboard user-dashboard">
      {/* Welcome section if no workspaces connected */}
      {(!connections || connections.length === 0) && <WelcomeSection />}

      {/* Configured Channels/DMs Section */}
      {connections && connections.length > 0 && (
        <div className="configured-section">
          <h4>Your Configured Channels & DMs</h4>
          <br />
          <div className="configured-workspaces-grid">
            {workspaceCards}
          </div>
          
          {allWorkspacesEmpty && <EmptyConfigured />}
        </div>
      )}
      
      <SnackbarComponent
        snackbar={snackbar}
        onClose={handleSnackbarClose}
      />
    </div>
  );
});

export default UserDashboard; 