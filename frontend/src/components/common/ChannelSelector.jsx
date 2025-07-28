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
  Settings,
  Save,
  X,
  CheckSquare,
  SquareStack,
  MessageCircle,
  Clock,
  ArrowLeft
} from 'lucide-react';
import SimpleSnackbar from './SimpleSnackbar';
import './ChannelSelector.css';

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

  const handleBackToConnections = () => {
    navigate('/slack-connect');
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
      
      setSnackbar({ message: 'Check the browser console for debug information', type: 'success', isVisible: true });
    } catch (error) {
      console.error('Debug test error:', error);
      setSnackbar({ message: 'Debug test failed - check console for details', type: 'error', isVisible: true });
    }
  };

  if (isLoadingChannels) {
    return (
      <div className="channel-selector-loading">
        <Loader className="loading-icon animate-spin" size={24} />
        <span className="loading-text">Loading channels and DMs...</span>
      </div>
    );
  }

  if (!channelsData) {
    return (
      <div className="channel-selector-error">
        <AlertCircle size={24} className="error-icon" />
        <span className="error-text">Failed to load channels. Please try again.</span>
        <button onClick={handleDebugTest} className="debug-button">
          Debug Test
        </button>
      </div>
    );
  }

  const filteredChannels = getFilteredChannels();
  const filteredDMs = getFilteredDMs();

  return (
    <div className="channel-selector-container">
      <SimpleSnackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={closeSnackbar}
        duration={4000}
      />
      
      <div className="channel-selector-header">
      

        <button
          onClick={handleSaveSettings}
          disabled={getTotalSelected() === 0 || saveChannelsMutation.isLoading}
          className={`save-button ${saveChannelsMutation.isLoading ? 'loading' : ''}`}
        >
          {saveChannelsMutation.isLoading ? (
            <>
              <Loader className="button-icon animate-spin" size={16} />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="button-icon" size={16} />
              <span>Save Settings</span>
            </>
          )}
        </button>
      </div>

      {/* Saved Selections Summary */}
      {/* {savedChannels && savedChannels.totalSelected > 0 && (
        <div className="saved-selections-summary">
          <div className="summary-header">
            <CheckCircle size={16} className="summary-icon" />
            <span className="summary-text">Currently monitoring {savedChannels.totalSelected} conversations</span>
          </div>
          <div className="summary-details">
            <div className="summary-detail">
              <Hash size={14} className="detail-icon" />
              <span className="detail-text">{savedChannels.selectedChannels.length} channels</span>
            </div>
            <div className="summary-detail">
              <User size={14} className="detail-icon" />
              <span className="detail-text">{savedChannels.selectedDMs.length} DMs</span>
            </div>
          </div>
        </div>
      )} */}

      {/* Controls */}
      <div className="selector-controls">
        <div className="search-filter-container">
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search channels and DMs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            {searchTerm && (
              <button
                className="search-clear-btn"
                onClick={() => setSearchTerm('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          
          <div className="filter-controls">
            <div className="filter-select-wrapper">
              <Filter size={14} className="filter-icon" />
              <select 
                value={filterType} 
                onChange={(e) => setFilterType(e.target.value)}
                className="filter-select"
                aria-label="Filter conversation type"
              >
                <option value="all">All Conversations</option>
                <option value="channels">Channels only</option>
                <option value="dms">DMs only</option>
              </select>
            </div>
            
            <label className="member-filter-label">
              <input
                type="checkbox"
                checked={showOnlyMember}
                onChange={(e) => setShowOnlyMember(e.target.checked)}
                className="member-checkbox"
              />
              <span>Only channels I'm in</span>
            </label>
          </div>
        </div>

        <div className="selection-controls">
          <button onClick={selectAll} className="control-button select-all">
            <CheckSquare size={14} />
            <span>Select All</span>
          </button>
          <button onClick={deselectAll} className="control-button deselect-all">
            <X size={14} />
            <span>Deselect All</span>
          </button>
          <div className="selection-count">
            <SquareStack size={14} />
            <span>{getTotalSelected()} selected</span>
          </div>
        </div>
      </div>

      {/* Channel and DM Lists */}
      <div className="conversations-container">
        {/* Channels */}
        {(filterType === 'all' || filterType === 'channels') && (
          <div className="section channels-section">
            <h3 className="section-title">
              <Hash size={16} className="section-icon" />
              <span>Channels ({filteredChannels.length})</span>
            </h3>
            
            {filteredChannels.length === 0 ? (
              <div className="empty-list">
                <MessageCircle size={24} className="empty-icon" />
                <p className="empty-text">No channels match your search criteria</p>
              </div>
            ) : (
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
            )}
          </div>
        )}

        {/* DMs */}
        {(filterType === 'all' || filterType === 'dms') && (
          <div className="section dms-section">
            <h3 className="section-title">
              <User size={16} className="section-icon" />
              <span>Direct Messages ({filteredDMs.length})</span>
            </h3>
            
            {filteredDMs.length === 0 ? (
              <div className="empty-list">
                <MessageCircle size={24} className="empty-icon" />
                <p className="empty-text">No direct messages match your search criteria</p>
              </div>
            ) : (
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
            )}
          </div>
        )}
      </div>

      {/* Settings info - keep this at the bottom for explanatory text */}
      <div className="settings-info">
        {getTotalSelected() === 0 && savedChannels && savedChannels.totalSelected > 0 && (
          <div className="info-alert">
            <AlertCircle size={14} className="alert-icon" />
            <span>
              You currently have {savedChannels.totalSelected} conversations selected. 
              Make changes above and click "Save Settings" to update.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelCard({ channel, isSelected, onToggle }) {
  return (
    <div 
      className={`channel-card ${isSelected ? 'selected' : ''}`} 
      onClick={onToggle}
      role="checkbox"
      aria-checked={isSelected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onToggle();
          e.preventDefault();
        }
      }}
    >
      <div className="card-header">
        <div className="channel-icon">
          {channel.isPrivate ? <Lock size={14} /> : <Hash size={14} />}
        </div>
        <div className="channel-name" title={channel.name}>#{channel.name}</div>
        <div className="selection-indicator">
          {isSelected ? 
            <CheckCircle size={16} className="check-icon" /> : 
            <Circle size={16} className="uncheck-icon" />
          }
        </div>
      </div>
      
      <div className="card-details">
        <div className="member-count">
          <Users size={12} />
          <span>{channel.memberCount} members</span>
        </div>
        
        {!channel.isMember && (
          <div className="not-member-badge">Not a member</div>
        )}
      </div>
      
      {(channel.purpose || channel.topic) && (
        <div className="channel-description" title={channel.purpose || channel.topic}>
          {channel.purpose || channel.topic}
        </div>
      )}
    </div>
  );
}

function DMCard({ dm, isSelected, onToggle }) {
  return (
    <div 
      className={`dm-card ${isSelected ? 'selected' : ''}`} 
      onClick={onToggle}
      role="checkbox"
      aria-checked={isSelected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onToggle();
          e.preventDefault();
        }
      }}
    >
      <div className="card-header">
        <div className="dm-icon">
          {dm.isGroup ? <Users size={14} /> : <User size={14} />}
        </div>
        <div className="dm-name" title={dm.name}>{dm.name}</div>
        <div className="selection-indicator">
          {isSelected ? 
            <CheckCircle size={16} className="check-icon" /> : 
            <Circle size={16} className="uncheck-icon" />
          }
        </div>
      </div>
      
      <div className="card-details">
        <div className="dm-type">
          {dm.isGroup ? 'Group DM' : 'Direct Message'}
        </div>
        {dm.memberCount && (
          <div className="member-count">
            <Users size={12} />
            <span>{dm.memberCount} members</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChannelSelector; 