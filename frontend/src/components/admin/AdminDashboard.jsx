import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
// import { useAuth } from '../../contexts/AuthContext';
import { useQuery, useQueryClient } from 'react-query';
import axios from 'axios';
import {
  Calendar,
  Clock,
  MessageSquare,
  Database,
  Slack,
  Target,
  History,
  Hash,
  User,
  ToggleRight,
  ToggleLeft,
  Loader
} from 'lucide-react';
import SimpleSnackbar from '../common/SimpleSnackbar';
import StatCard from '../common/StatCard';
import Skeleton from '../common/Skeleton';
import './AdminControlDashboard.css';

function AdminDashboard() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveContent, setSaveContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [exportingChannelHistory, setExportingChannelHistory] = useState({});
  const [togglingChannelDaily, setTogglingChannelDaily] = useState({});
  const [queuedExportJobs, setQueuedExportJobs] = useState({});
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  
  // Generalized export range state
  const [exportMode, setExportMode] = useState('days'); // 'all', 'year', 'month', 'days'
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportMonth, setExportMonth] = useState(new Date().getMonth() + 1);
  const [exportDays, setExportDays] = useState(90);
  
  // Compose exportRange object for backend
  const exportRange =
    exportMode === 'all' ? { type: 'full' } :
    exportMode === 'year' ? { type: 'year', year: exportYear } :
    exportMode === 'month' ? { type: 'month', year: exportYear, month: exportMonth } :
    { type: 'days', days: exportDays };
    
  // Effect to refetch data when navigating to this component
  useEffect(() => {
    // Force refetch all queries when component mounts or location changes
    queryClient.invalidateQueries('admin-connections');
    queryClient.invalidateQueries('analysis-summary');
    queryClient.invalidateQueries('recent-reports');
    queryClient.invalidateQueries('dashboard-stats');
    queryClient.invalidateQueries('admin-all-channel-selections');
  }, [queryClient, location.pathname]);

  // Helper to get years/months for dropdown
  const getYearOptions = () => {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear - 1];
  };
  const getMonthOptions = (year) => {
    const months = [];
    const now = new Date();
    const maxMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
    for (let m = 1; m <= maxMonth; m++) months.push(m);
    return months;
  };

  // Fetch all connections (admin endpoint)
  const { data: connections, isLoading: connectionsLoading } = useQuery(
    'admin-connections',
    async () => {
      const response = await axios.get('/api/slack/admin/connections');
      return response.data.connections;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 0,
      onError: (err) => {
        console.error("Failed to load connections:", err);
        setSnackbar({ isVisible: true, message: 'Failed to load connections. Please try again.', type: 'error' });
      }
    }
  );

  // Admin-specific queries
  const { data: summary, isLoading: summaryLoading } = useQuery(
    'analysis-summary',
    async () => {
      const response = await axios.get('/api/analysis/summary');
      return response.data;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 0
    }
  );

  const { data: reports, isLoading: reportsLoading } = useQuery(
    'recent-reports',
    async () => {
      const response = await axios.get('/api/reports?limit=5');
      return response.data.reports;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 0
    }
  );

  const { data: dashboardStats, isLoading: statsLoading } = useQuery(
    'dashboard-stats',
    async () => {
      const response = await axios.get('/api/analysis/dashboard-stats');
      return response.data;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 0,
      refetchInterval: 10000, // Refetch every 10 seconds
      onSuccess: (data) => {
        // Update queued job status based on active jobs
        if (data?.activeJobs) {
          setQueuedExportJobs(prev => {
            const updated = { ...prev };

            // Check if any queued jobs are no longer active
            Object.keys(updated).forEach(key => {
              if (updated[key]) {
                const isStillActive = data.activeJobs.some(job =>
                  job.type === 'history-export' &&
                  (key.includes(job.connectionId) || key === job.connectionId)
                );
                if (!isStillActive) {
                  updated[key] = false;
                }
              }
            });

            return updated;
          });
        }
      }
    }
  );

  const { data: allChannelSelections, isLoading: allChannelSelectionsLoading } = useQuery(
    'admin-all-channel-selections',
    async () => {
      console.log('Fetching admin all channel selections...');
      const response = await axios.get('/api/slack/admin/all-channel-selections');
      console.log('Admin all channel selections response:', response.data);
      return response.data;
    },
    {
      suspense: false,
      retry: 2,
      refetchOnMount: true,
      staleTime: 0,
      refetchInterval: 30000, // Refetch every 30 seconds
      onError: (error) => {
        console.error('Error fetching admin all channel selections:', error);
      }
    }
  );

  const handleSaveConversation = async () => {
    if (!saveTitle || !saveContent) return;

    setIsSaving(true);
    try {
      const response = await axios.post('/api/slack/save-conversation', {
        title: saveTitle,
        content: saveContent,
        conversationType: 'dashboard-conversation'
      });

      setSnackbar({ isVisible: true, message: 'Conversation saved to Google Drive successfully!', type: 'success' });
      setSaveDialogOpen(false);
      setSaveTitle('');
      setSaveContent('');
    } catch (error) {
      console.error('Error saving conversation:', error);
      setSnackbar({ isVisible: true, message: 'Error saving conversation. Please try again.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };


  // Admin handlers for individual channel operations
  const handleExportChannelHistory = async (connectionId, channelId, channelName, channelType, userId) => {
    const key = `${connectionId}-${channelId}-${userId}`;
    setExportingChannelHistory(prev => ({ ...prev, [key]: true }));

    try {
      const response = await axios.post('/api/slack/admin/export-channel-history', {
        connectionId,
        channelId,
        channelName,
        channelType,
        userId,
        range: exportRange || { type: 'days', days: 90 }
      });
      setQueuedExportJobs(prev => ({ ...prev, [key]: true }));
      setSnackbar({ isVisible: true, message: `History export job queued for ${channelName || channelId}!`, type: 'success' });
    } catch (error) {
      console.error('Error starting channel history export:', error);
      let errorMsg = 'Error starting history export. Please try again.';
      if (error.response && error.response.data && error.response.data.error) {
        errorMsg = error.response.data.error;
      }
      setSnackbar({ isVisible: true, message: errorMsg, type: 'error' });
    } finally {
      setExportingChannelHistory(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleToggleChannelDailyExport = async (connectionId, channelId, enabled, userId) => {
    const key = `${connectionId}-${channelId}-${userId}`;
    setTogglingChannelDaily(prev => ({ ...prev, [key]: true }));

    try {
      const response = await axios.post('/api/slack/admin/toggle-channel-daily-export', {
        connectionId,
        channelId,
        enabled,
        userId
      });
      setSnackbar({ isVisible: true, message: `Daily export ${enabled ? 'enabled' : 'disabled'} for channel`, type: 'success' });
      
      // Update local state instead of reloading the page
      queryClient.invalidateQueries('admin-all-channel-selections');
    } catch (error) {
      console.error('Error toggling channel daily export:', error);
      setSnackbar({ isVisible: true, message: 'Error toggling daily export. Please try again.', type: 'error' });
    } finally {
      setTogglingChannelDaily(prev => ({ ...prev, [key]: false }));
    }
  };

  if (connectionsLoading) {
    return (
      <div className="dashboard admin-dashboard">
        <div className="stats-grid">
          <Skeleton width="220px" height="75px" shape="rounded" />
          <Skeleton width="220px" height="75px" shape="rounded" />
          <Skeleton width="220px" height="75px" shape="rounded" />
          <Skeleton width="220px" height="75px" shape="rounded" />
        </div>
        <div className="card large-card">
          <Skeleton width="220px" height="2em" style={{ marginBottom: 16 }} shape="rounded" />
          <Skeleton width="120px" height="1.2em" style={{ marginBottom: 24 }} shape="rounded" />
          <Skeleton width="100%" height="4em" shape="rounded" />
        </div>
      </div>
    );
  }

  const hasConnections = connections && connections.length > 0;
  const hasSummary = summary && summary.topTasks && summary.topTasks.length > 0;
  const stats = dashboardStats?.stats || {};

  return (
    <div className="dashboard admin-dashboard">
      {/* Enhanced Quick Stats */}
      <div className="stats-grid">
        <StatCard
          icon={MessageSquare}
          value={stats.totalMessages?.toLocaleString() || 0}
          label="Total Messages Fetched"
          accent="primary"
          status={stats.messagesLast24h ? `+${stats.messagesLast24h} in 24h` : undefined}
          statusColor="success"
        />
        <StatCard
          icon={Slack}
          value={[...new Set((connections && Array.isArray(connections)) ? connections.map(conn => conn.slackTeamId) : [])].length || 0}
          label="Connected Workspaces"
          accent="success"
        />
        <StatCard
          icon={Target}
          value={summary?.topTasks?.length || 0}
          label="Automation Opportunities"
          accent="warning"
          status={summary?.summary?.find(s => s.estimatedRoi === 'high')?._count?.id ? `${summary.summary.find(s => s.estimatedRoi === 'high')._count.id} high ROI` : undefined}
          statusColor="warning"
        />
        <StatCard
          icon={Database}
          value={stats.totalChannelSelections || 0}
          label="Channels Monitored"
          accent="danger"
          status={stats.totalCompletedJobs ? `${stats.totalCompletedJobs} completed today` : undefined}
          statusColor="success"
        />
      </div>

      {/* Main Content */}
      <div className="dashboard-content">
        {/* All Users Channel Selections - Admin Only */}
        <div className="card large-card">
          <div className="card-header">
            <h3>All Users Channel Selections</h3>
            <span className="status-badge">
              {allChannelSelections?.selections?.length || 0} total selections
            </span>
          </div>
          <div className="export-range-container">
            <div className="export-range-header">
              <h4>Export Range</h4>
              <div className="export-range-info">
                <Calendar size={14} />
                <span>Affects all exports below</span>
              </div>
            </div>
            
            <div className="export-range-controls">
              <div className="export-range-select">
                <label htmlFor="export-mode">Mode:</label>
                <select
                  id="export-mode"
                  className="export-range-dropdown"
                  value={exportMode}
                  onChange={e => setExportMode(e.target.value)}
                >
                  <option value="all">All (Full History)</option>
                  <option value="year">Specific Year</option>
                  <option value="month">Specific Month</option>
                  <option value="days">Last N Days</option>
                </select>
              </div>
              
              {exportMode === 'year' && (
                <div className="export-range-select">
                  <label htmlFor="export-year">Year:</label>
                  <select
                    id="export-year"
                    className="export-range-dropdown"
                    value={exportYear}
                    onChange={e => setExportYear(Number(e.target.value))}
                  >
                    {getYearOptions().map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
              )}
              
              {exportMode === 'month' && (
                <>
                  <div className="export-range-select">
                    <label htmlFor="export-month-year">Year:</label>
                    <select
                      id="export-month-year"
                      className="export-range-dropdown"
                      value={exportYear}
                      onChange={e => setExportYear(Number(e.target.value))}
                    >
                      {getYearOptions().map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>
                  <div className="export-range-select">
                    <label htmlFor="export-month">Month:</label>
                    <select
                      id="export-month"
                      className="export-range-dropdown"
                      value={exportMonth}
                      onChange={e => setExportMonth(Number(e.target.value))}
                    >
                      {getMonthOptions(exportYear).map(month => (
                        <option key={month} value={month}>
                          {new Date(exportYear, month-1, 1).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              
              {exportMode === 'days' && (
                <div className="export-range-select">
                  <label htmlFor="export-days">Last</label>
                  <div className="export-days-input">
                    <input
                      id="export-days"
                      type="number"
                      min={1}
                      max={3650}
                      value={exportDays}
                      onChange={e => setExportDays(Number(e.target.value))}
                    />
                    <span>days</span>
                  </div>
                </div>
              )}
              
              <div className="export-range-summary">
                <span>Current selection:</span>
                <strong>
                  {exportMode === 'all' && 'All time'}
                  {exportMode === 'year' && `Year ${exportYear}`}
                  {exportMode === 'month' && `${new Date(exportYear, exportMonth-1, 1).toLocaleString('default', { month: 'long' })} ${exportYear}`}
                  {exportMode === 'days' && `Last ${exportDays} days`}
                </strong>
              </div>
            </div>
          </div>

          <div className="card-content">
            {allChannelSelectionsLoading ? (
              <div className="loading">
                <Skeleton width="48px" height="48px" shape="circle" style={{ marginBottom: 12 }} />
                <Skeleton width="180px" height="1.5em" style={{ marginBottom: 12 }} shape="rounded" />
                <Skeleton width="100%" height="4em" shape="rounded" />
              </div>
            ) : allChannelSelections?.groupedSelections && allChannelSelections.groupedSelections.length > 0 ? (
              <div className="all-users-selections">
                {allChannelSelections.groupedSelections.map((userData) => (
                  <div key={userData.user.id} className="user-selections-section">
                    <div className="user-header">
                      <h4>{userData.user.name || userData.user.email}</h4>
                      <span className="user-email">{userData.user.email}</span>
                    </div>

                    {Object.values(userData.connections).map((connectionData) => (
                      <div key={connectionData.connection.id} className="connection-selections">
                        <div className="connection-header">
                          <svg className="slack-logo" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                            <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>
                            <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>
                            <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>
                            <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                          </svg>
                          <span className="workspace-name" title={connectionData.connection.slackTeamName}>{connectionData.connection.slackTeamName}</span>
                        </div>

                        <div className="channel-selections-grid">
                          {connectionData.selections.map((selection) => {
                            const exportKey = `${connectionData.connection.id}-${selection.channelId}-${userData.user.id}`;
                            const isExporting = exportingChannelHistory[exportKey];
                            const isToggling = togglingChannelDaily[exportKey];
                            const isCompleted = selection.status === 'completed';

                            const isExportDisabled = (
                              isExporting ||
                              queuedExportJobs[exportKey] ||
                              exportingChannelHistory[exportKey] ||
                              selection.status === 'pending' ||
                              selection.status === 'running' ||
                              selection.status === 'completed'
                            );

                            return (
                              <div key={selection.id} className="channel-selection-item">
                                <div className="channel-info">
                                  <div className="channel-icon">
                                    {selection.channelType === 'channel' ? <Hash size={14} /> : <User size={14} />}
                                  </div>
                                  <div className="channel-details">
                                    <span className="channel-name" title={selection.channelName || selection.channelId}>
                                      {selection.channelName || selection.channelId}
                                    </span>
                                    <span className="channel-type">
                                      {selection.channelType === 'channel' ? 'Channel' : 'DM'}
                                    </span>
                                  </div>
                                </div>

                                <div className="channel-actions">
                                  <button
                                    className="action-button small history-export"
                                    onClick={() => handleExportChannelHistory(
                                      connectionData.connection.id,
                                      selection.channelId,
                                      selection.channelName,
                                      selection.channelType,
                                      userData.user.id
                                    )}
                                    disabled={isExportDisabled}
                                    title={queuedExportJobs[exportKey] ? "Export job is queued" : isExportDisabled ? "Export not available" : "Export message history for this channel/DM"}
                                  >
                                    {isExporting ? <Loader size={14} className="spinning" /> :
                                     queuedExportJobs[exportKey] ? <Clock size={14} /> : <History size={14} />}
                                    <span>{queuedExportJobs[exportKey] ? 'Queued' : isCompleted ? 'Completed' : 'History Export'}</span>
                                  </button>

                                  <button
                                    className={`toggle-button small ${selection.dailyExportEnabled ? 'enabled' : 'disabled'}`}
                                    onClick={() => handleToggleChannelDailyExport(
                                      connectionData.connection.id,
                                      selection.channelId,
                                      !selection.dailyExportEnabled,
                                      userData.user.id
                                    )}
                                    disabled={isToggling}
                                    title={`${selection.dailyExportEnabled ? 'Disable' : 'Enable'} daily message fetching`}
                                  >
                                    {isToggling ? (
                                      <Loader size={14} className="spinning" />
                                    ) : selection.dailyExportEnabled ? (
                                      <ToggleRight size={14} />
                                    ) : (
                                      <ToggleLeft size={14} />
                                    )}
                                    <span>Daily</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Database size={48} className="empty-icon" />
                <p className="empty-text">No channel selections found across all users.</p>
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="card large-card">
            <div className="card-header">
              <h4>Messages Fetched (Last 7 Days)</h4>
            </div>
            <div className="card-content">
              {dashboardStats?.dailyStats && (
                <div className="daily-chart">
                  <div className="chart-bars">
                    {dashboardStats.dailyStats.map((day, index) => (
                      <div key={index} className="chart-bar">
                        <div
                          className="bar"
                          style={{
                            height: `${Math.max(4, (day.messages / Math.max(...dashboardStats.dailyStats.map(d => d.messages))) * 100)}%`
                          }}
                        />
                        <span className="bar-label">{new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                        <span className="bar-value">{day.messages}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Active Jobs */}
          {dashboardStats?.activeJobs && dashboardStats.activeJobs.length > 0 && (
            <div className="card large-card">
              <div className="card-header">
                <h3>Currently Fetching</h3>
                <span className="status-badge active">{dashboardStats.activeJobs.length} active</span>
              </div>
              <div className="card-content">
                <div className="active-jobs">
                  {dashboardStats.activeJobs.map((job) => (
                    <div key={job.id} className="job-item">
                      <div className="job-info">
                                                  <h4>
                            {job.slackConnection.slackTeamName}
                            <span className="job-channel-name" title={job.channelName ? `#${job.channelName}` : (job.channelId ? `#${job.channelId}` : '')}>
                              {job.channelName ? `#${job.channelName}` : (job.channelId ? `#${job.channelId}` : '')}
                            </span>
                          </h4>
                        <p>Fetching messages...</p>
                      </div>
                      <div className="job-progress">
                        <div className="progress-bar">
                          <div
                            className="progress-fill"
                            style={{ width: `${job.progress || 0}%` }}
                          />
                        </div>
                        <span>{job.messagesScraped || 0} messages</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Conversation Dialog */}
      {saveDialogOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Save Conversation to Google Drive</h3>
              <button
                className="close-btn"
                onClick={() => setSaveDialogOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="Enter conversation title"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Content</label>
                <textarea
                  className="form-input"
                  value={saveContent}
                  onChange={(e) => setSaveContent(e.target.value)}
                  placeholder="Paste your conversation content here..."
                  rows={10}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={handleSaveConversation}
                disabled={!saveTitle || !saveContent || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save to Google Drive'}
              </button>
            </div>
          </div>
        </div>
      )}
      <SimpleSnackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={() => setSnackbar(prev => ({ ...prev, isVisible: false }))}
        duration={5000}
      />
    </div>
  );
}

export default AdminDashboard; 