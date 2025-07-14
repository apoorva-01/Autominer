import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from 'react-query';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  Hash, 
  Lock, 
  User, 
  Users, 
  CheckCircle, 
  Circle, 
  Play, 
  Loader,
  AlertCircle,
  Search,
  Filter,
  Settings
} from 'lucide-react';
import Snackbar from './Snackbar';

function ChannelSelector({ connection, onScrapeComplete }) {
  const navigate = useNavigate();
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [selectedDMs, setSelectedDMs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'channels', 'dms'
  const [showOnlyMember, setShowOnlyMember] = useState(true); // default to true
  const [snackbar, setSnackbar] = useState({
    isVisible: false,
    message: '',
    type: 'success'
  });

  // Fetch channels and DMs
  const { data: channelsData, isLoading: isLoadingChannels } = useQuery(
    ['channels', connection.id],
    async () => {
      const response = await axios.get(`/api/slack/connections/${connection.id}/channels`);
      return response.data;
    },
    {
      enabled: !!connection.id
    }
  );

  // Fetch saved channel selections
  const { data: savedChannels, refetch: refetchSavedChannels } = useQuery(
    ['saved-channels', connection.id],
    async () => {
      const response = await axios.get(`/api/slack/connections/${connection.id}/saved-channels`);
      return response.data;
    },
    {
      enabled: !!connection.id
    }
  );

  // Fetch progress status
  const { data: progressStatus, refetch: refetchProgress } = useQuery(
    ['progress', connection.id],
    async () => {
      const response = await axios.get(`/api/slack/connections/${connection.id}/progress`);
      return response.data;
    },
    {
      enabled: !!connection.id,
      refetchInterval: 5000 // Refetch every 5 seconds when fetching is active
    }
  );

  // Save channel selections mutation
  const saveChannelsMutation = useMutation(
    async ({ selectedChannels, selectedDMs }) => {
      const response = await axios.post(`/api/slack/connections/${connection.id}/save-channels`, {
        selectedChannels,
        selectedDMs
      });
      return response.data;
    },
    {
      onSuccess: (data) => {
        console.log('Channel selections saved:', data);
        refetchSavedChannels();
        refetchProgress();
        
        // Show success snackbar
        setSnackbar({
          isVisible: true,
          message: `Successfully saved ${getTotalSelected()} channel selections!`,
          type: 'success'
        });
        
        // Navigate to dashboard after a short delay
        setTimeout(() => {
          navigate('/');
        }, 1500);
        
        if (onScrapeComplete) {
          onScrapeComplete(data);
        }
      },
      onError: (error) => {
        console.error('Failed to save channel selections:', error);
        
        // Show error snackbar
        setSnackbar({
          isVisible: true,
          message: 'Failed to save channel selections. Please try again.',
          type: 'error'
        });
      }
    }
  );

  // Handle channel selection
  const toggleChannelSelection = (channelId) => {
    setSelectedChannels(prev => 
      prev.includes(channelId) 
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    );
  };

  const toggleDMSelection = (dmId) => {
    setSelectedDMs(prev => 
      prev.includes(dmId) 
        ? prev.filter(id => id !== dmId)
        : [...prev, dmId]
    );
  };

  const selectAll = () => {
    if (channelsData) {
      const visibleChannels = getFilteredChannels();
      const visibleDMs = getFilteredDMs();
      
      setSelectedChannels(visibleChannels.map(c => c.id));
      setSelectedDMs(visibleDMs.map(dm => dm.id));
    }
  };

  const deselectAll = () => {
    setSelectedChannels([]);
    setSelectedDMs([]);
  };

  // Load saved selections when data is available
  useEffect(() => {
    if (savedChannels && savedChannels.selectedChannels && savedChannels.selectedDMs) {
      setSelectedChannels(savedChannels.selectedChannels);
      setSelectedDMs(savedChannels.selectedDMs);
    }
  }, [savedChannels]);

  const handleSaveSettings = () => {
    saveChannelsMutation.mutate({ selectedChannels, selectedDMs });
  };

  const closeSnackbar = () => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  const getFilteredChannels = () => {
    if (!channelsData?.channels) return [];
    
    return channelsData.channels.filter(channel => {
      const matchesSearch = channel.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filterType === 'all' || filterType === 'channels';
      const matchesMember = !showOnlyMember || channel.isMember;
      
      return matchesSearch && matchesFilter && matchesMember;
    });
  };

  const getFilteredDMs = () => {
    if (!channelsData?.dms) return [];
    return channelsData.dms.filter(dm => {
      // Only include 1:1 DMs, not group DMs
      if (dm.isGroup) return false;
      const matchesSearch = dm.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filterType === 'all' || filterType === 'dms';
      return matchesSearch && matchesFilter;
    });
  };

  const getTotalSelected = () => selectedChannels.length + selectedDMs.length;

  const handleDebugTest = async () => {
    try {
      console.log('Testing connection:', connection.id);
      
      // Test the token first
      const tokenResponse = await axios.get(`/api/slack/connections/${connection.id}/test-token`);
      console.log('Token test result:', tokenResponse.data);
      
      // Test channels endpoint
      const channelsResponse = await axios.get(`/api/slack/connections/${connection.id}/channels`);
      console.log('Channels response:', channelsResponse.data);
      
      alert('Check the browser console for debug information');
    } catch (error) {
      console.error('Debug test error:', error);
      alert('Debug test failed - check console for details');
    }
  };

  if (isLoadingChannels) {
    return (
      <div className="channel-selector-loading">
        <Loader className="animate-spin" size={24} />
        <span>Loading channels and DMs...</span>
      </div>
    );
  }

  if (!channelsData) {
    return (
      <div className="channel-selector-error">
        <AlertCircle size={24} />
        <span>Failed to load channels. Please try again.</span>
        <button onClick={handleDebugTest} className="debug-test-btn">
          Debug Test
        </button>
      </div>
    );
  }

  const filteredChannels = getFilteredChannels();
  const filteredDMs = getFilteredDMs();

  return (
    <div className="channel-selector">
      <Snackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={closeSnackbar}
        duration={4000}
      />
      <div className="channel-selector-header">
        <h2>Select Channels & DMs to Monitor</h2>
        <p>Choose which conversations you want to automatically fetch and save to Google Drive.</p>
        {/* <button onClick={handleDebugTest} className="debug-test-btn">
          Debug Test
        </button> */}
      </div>

      {/* Progress Status */}
      {progressStatus && progressStatus.isActive && (
        <div className="progress-status">
          <div className="status-header">
            <Loader className="animate-spin" size={16} />
            <span>Fetching messages...</span>
          </div>
          <div className="status-details">
            <div className="status-counts">
              <span>Pending: {progressStatus.stats.pending || 0}</span>
              <span>In Progress: {progressStatus.stats.inProgress || 0}</span>
              <span>Completed: {progressStatus.stats.completed || 0}</span>
              {progressStatus.stats.failed && (
                <span className="failed">Failed: {progressStatus.stats.failed}</span>
              )}
            </div>
            <div className="message-count">
              <span>Total Messages Fetched: {progressStatus.stats.totalMessages || 0}</span>
            </div>
          </div>
        </div>
      )}

      {/* Saved Selections Summary */}
      {savedChannels && savedChannels.totalSelected > 0 && (
        <div className="saved-selections-summary">
          <div className="summary-header">
            <CheckCircle size={16} />
            <span>Currently monitoring {savedChannels.totalSelected} conversations</span>
          </div>
          <div className="summary-details">
            <span>{savedChannels.selectedChannels.length} channels</span>
            <span>{savedChannels.selectedDMs.length} DMs</span>
            {progressStatus && (
              <span>
                {progressStatus.stats.totalMessages} messages saved to Google Drive
              </span>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="channel-selector-controls">
        <div className="search-filter-controls">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search channels and DMs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="filter-controls">
            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">All</option>
              <option value="channels">Channels only</option>
              <option value="dms">DMs only</option>
            </select>
            
            <label className="member-filter">
              <input
                type="checkbox"
                checked={showOnlyMember}
                onChange={(e) => setShowOnlyMember(e.target.checked)}
              />
              <span>Only channels I'm in</span>
            </label>
          </div>
        </div>

        <div className="selection-controls">
          <button onClick={selectAll} className="select-all-btn">
            Select All Visible
          </button>
          <button onClick={deselectAll} className="deselect-all-btn">
            Deselect All
          </button>
          <span className="selection-count">
            {getTotalSelected()} selected
          </span>
        </div>
      </div>

      {/* Channel and DM Lists */}
      <div className="channel-dm-lists">
        {/* Channels */}
        {(filterType === 'all' || filterType === 'channels') && (
          <div className="channels-section">
            <h3>
              <Hash size={16} />
              Channels ({filteredChannels.length})
            </h3>
            <div className="channels-grid">
              {filteredChannels.map(channel => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  isSelected={selectedChannels.includes(channel.id)}
                  onToggle={() => toggleChannelSelection(channel.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* DMs */}
        {(filterType === 'all' || filterType === 'dms') && (
          <div className="dms-section">
            <h3>
              <User size={16} />
              Direct Messages ({filteredDMs.length})
            </h3>
            <div className="dms-grid">
              {filteredDMs.map(dm => (
                <DMCard
                  key={dm.id}
                  dm={dm}
                  isSelected={selectedDMs.includes(dm.id)}
                  onToggle={() => toggleDMSelection(dm.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save Settings Button */}
      <div className="save-settings-section">
        <button
          onClick={handleSaveSettings}
          disabled={getTotalSelected() === 0 || saveChannelsMutation.isLoading}
          className="save-settings-btn"
        >
          {saveChannelsMutation.isLoading ? (
            <>
              <Loader className="animate-spin" size={16} />
              Saving...
            </>
          ) : (
            <>
              <Settings size={16} />
              Save Settings
            </>
          )}
        </button>
        
        {getTotalSelected() > 0 && (
          <p className="settings-info">
            This will start fetching and saving messages from {getTotalSelected()} selected conversations 
            to Google Drive, with daily updates going forward.
          </p>
        )}
        
        {getTotalSelected() === 0 && savedChannels && savedChannels.totalSelected > 0 && (
          <p className="current-selections-info">
            You currently have {savedChannels.totalSelected} conversations selected. 
            Make changes above and click "Save Settings" to update.
          </p>
        )}
      </div>
    </div>
  );
}

function ChannelCard({ channel, isSelected, onToggle }) {
  return (
    <div className={`channel-card ${isSelected ? 'selected' : ''}`} onClick={onToggle}>
      <div className="channel-header">
        <div className="channel-icon">
          {channel.isPrivate ? <Lock size={14} /> : <Hash size={14} />}
        </div>
        <div className="channel-name">#{channel.name}</div>
        <div className="selection-indicator">
          {isSelected ? <CheckCircle size={16} /> : <Circle size={16} />}
        </div>
      </div>
      
      <div className="channel-details">
        <div className="channel-members">
          <Users size={12} />
          <span>{channel.memberCount} members</span>
        </div>
        
        {!channel.isMember && (
          <div className="not-member-badge">Not a member</div>
        )}
      </div>
      
      {(channel.purpose || channel.topic) && (
        <div className="channel-description">
          {channel.purpose || channel.topic}
        </div>
      )}
    </div>
  );
}

function DMCard({ dm, isSelected, onToggle }) {
  return (
    <div className={`dm-card ${isSelected ? 'selected' : ''}`} onClick={onToggle}>
      <div className="dm-header">
        <div className="dm-icon">
          {dm.isGroup ? <Users size={14} /> : <User size={14} />}
        </div>
        <div className="dm-name">{dm.name}</div>
        <div className="selection-indicator">
          {isSelected ? <CheckCircle size={16} /> : <Circle size={16} />}
        </div>
      </div>
      
      <div className="dm-details">
        <div className="dm-type">
          {dm.isGroup ? 'Group DM' : 'Direct Message'}
        </div>
        {dm.memberCount && (
          <div className="dm-members">
            <Users size={12} />
            <span>{dm.memberCount} members</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChannelSelector; 