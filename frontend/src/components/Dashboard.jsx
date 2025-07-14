import React, { useState } from 'react';
import { useQuery, useQueries } from 'react-query';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  BarChart3,
  Slack,
  FileText,
  Plus,
  TrendingUp,
  Clock,
  Target,
  Database,
  Activity,
  CheckCircle,
  Download,
  MessageSquare,
  Calendar,
  ArrowUp,
  ArrowDown,
  Save,
  History,
  ToggleLeft,
  ToggleRight,
  Loader,
  Hash,
  User
} from 'lucide-react';
import StatCard from './StatCard';
import { useAuth } from '../contexts/AuthContext';
import Snackbar from './Snackbar';

function Dashboard() {
  const { isAdmin, user } = useAuth();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveContent, setSaveContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);
  const [togglingDaily, setTogglingDaily] = useState(false);
  const [exportingChannelHistory, setExportingChannelHistory] = useState({});
  const [togglingChannelDaily, setTogglingChannelDaily] = useState({});
  const [queuedExportJobs, setQueuedExportJobs] = useState({});
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });

  // Always fetch connections for both admin and user
  const { data: connections, isLoading: connectionsLoading } = useQuery(
    'slack-connections',
    async () => {
      const response = await axios.get('/api/slack/connections');
      return response.data.connections;
    }
  );

  // Prepare queries for all connections (avoid hooks in loops)
  const savedChannelsQueries = useQueries(
    (connections || []).map(conn => ({
      queryKey: ['saved-channels', conn.id],
      queryFn: () => axios.get(`/api/slack/connections/${conn.id}/saved-channels`).then(res => res.data),
      enabled: !!conn.id,
    }))
  );

  const channelsInfoQueries = useQueries(
    (connections || []).map(conn => ({
      queryKey: ['channels-info', conn.id],
      queryFn: () => axios.get(`/api/slack/connections/${conn.id}/channels`).then(res => res.data),
      enabled: !!conn.id,
    }))
  );

  // Only fetch admin-only data if isAdmin
  let summary, summaryLoading, reports, reportsLoading, dashboardStats, statsLoading, overallProgress, progressLoading, allChannelSelections, allChannelSelectionsLoading;
  if (isAdmin) {
    ({ data: summary, isLoading: summaryLoading } = useQuery(
      'analysis-summary',
      async () => {
        const response = await axios.get('/api/analysis/summary');
        return response.data;
      }
    ));

    ({ data: reports, isLoading: reportsLoading } = useQuery(
      'recent-reports',
      async () => {
        const response = await axios.get('/api/reports?limit=5');
        return response.data.reports;
      }
    ));

    ({ data: dashboardStats, isLoading: statsLoading } = useQuery(
      'dashboard-stats',
      async () => {
        const response = await axios.get('/api/analysis/dashboard-stats');
        return response.data;
      },
      {
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
    ));

    ({ data: overallProgress, isLoading: progressLoading } = useQuery(
      'overall-progress',
      async () => {
        if (!connections || connections.length === 0) return null;
        const progressData = await Promise.all(
          connections.map(async (connection) => {
            try {
              const response = await axios.get(`/api/slack/connections/${connection.id}/progress`);
              return {
                connection,
                progress: response.data
              };
            } catch (error) {
              console.error(`Error fetching progress for ${connection.id}:`, error);
              return {
                connection,
                progress: null
              };
            }
          })
        );
        return progressData.filter(p => p.progress !== null);
      },
      {
        enabled: !!connections && connections.length > 0,
        refetchInterval: 10000 // Refetch every 10 seconds
      }
    ));

    ({ data: allChannelSelections, isLoading: allChannelSelectionsLoading } = useQuery(
      'admin-all-channel-selections',
      async () => {
        console.log('Fetching admin all channel selections...');
        const response = await axios.get('/api/slack/admin/all-channel-selections');
        console.log('Admin all channel selections response:', response.data);
        return response.data;
      },
      {
        refetchInterval: 30000, // Refetch every 30 seconds
        onError: (error) => {
          console.error('Error fetching admin all channel selections:', error);
        }
      }
    ));
  }

  const handleSaveConversation = async () => {
    if (!saveTitle || !saveContent) return;

    setIsSaving(true);
    try {
      const response = await axios.post('/api/slack/save-conversation', {
        title: saveTitle,
        content: saveContent,
        conversationType: 'dashboard-conversation'
      });

      alert('Conversation saved to Google Drive successfully!');
      setSaveDialogOpen(false);
      setSaveTitle('');
      setSaveContent('');
    } catch (error) {
      console.error('Error saving conversation:', error);
      alert('Error saving conversation. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleHistoryExport = async (connectionId) => {
    setExportingHistory(true);
    try {
      const response = await axios.post(`/api/slack/connections/${connectionId}/export-history`);
      setQueuedExportJobs(prev => ({ ...prev, [connectionId]: true }));
      alert(`History export started! ${response.data.jobsCreated} jobs created. Check progress below.`);
    } catch (error) {
      console.error('Error starting history export:', error);
      alert('Error starting history export. Please try again.');
    } finally {
      setExportingHistory(false);
    }
  };

  const handleToggleDailyExport = async (connectionId, channelId, enabled) => {
    setTogglingDaily(true);
    try {
      const response = await axios.post(`/api/slack/connections/${connectionId}/toggle-daily-export`, {
        channelId,
        enabled
      });
      alert(`Daily export ${enabled ? 'enabled' : 'disabled'} for channel`);
      // Refetch progress to update the UI
      if (overallProgress) {
        // Trigger refetch by invalidating the query
        window.location.reload(); // Simple refresh for now
      }
    } catch (error) {
      console.error('Error toggling daily export:', error);
      alert('Error toggling daily export. Please try again.');
    } finally {
      setTogglingDaily(false);
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
        userId
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
      alert(`Daily export ${enabled ? 'enabled' : 'disabled'} for channel`);
      // Refetch data to update the UI
      window.location.reload();
    } catch (error) {
      console.error('Error toggling channel daily export:', error);
      alert('Error toggling daily export. Please try again.');
    } finally {
      setTogglingChannelDaily(prev => ({ ...prev, [key]: false }));
    }
  };

  if (!isAdmin) {
    // Regular user: show connect/configure UI and configured channels/DMs
    return (
      <div className="dashboard">
        {/* Only show welcome if no workspaces connected */}
        {(!connections || connections.length === 0) && (
          <div className="welcome-section">
            <div className="welcome-card">
              <h2>Welcome!</h2>
              <p>
                Connect your Slack workspace to begin discovering automation opportunities from your team conversations.
              </p>
              <Link to="/slack-connect" className="cta-button">
                <Plus size={20} />
                Connect Slack Workspace
              </Link>
            </div>
          </div>
        )}
        {/* Configured Channels/DMs Section */}
        {connections && connections.length > 0 && (
          <div className="configured-section" style={{ marginTop: '2em' }}>
            <h3 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1.5em', color: '#23272f' }}>Your Configured Channels & DMs</h3>
            <div className="configured-workspaces-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '2em' }}>
              {connections.map((connection, idx) => {
                const savedChannels = savedChannelsQueries[idx]?.data;
                const loadingSaved = savedChannelsQueries[idx]?.isLoading;
                const channelsInfo = channelsInfoQueries[idx]?.data;
                const loadingChannelsInfo = channelsInfoQueries[idx]?.isLoading;
                // Build lookup maps for channel and DM names
                const channelMap = (channelsInfo?.channels || []).reduce((acc, ch) => { acc[ch.id] = ch.name; return acc; }, {});
                const dmMap = (channelsInfo?.dms || []).reduce((acc, dm) => { acc[dm.id] = dm.name; return acc; }, {});
                return (
                  <div
                    key={connection.id}
                    className="configured-workspace-card"
                    style={{
                      background: 'linear-gradient(135deg, #f8fafc 60%, #e0e7ef 100%)',
                      borderRadius: '1.25em',
                      boxShadow: '0 4px 16px rgba(60,60,100,0.07)',
                      padding: '2em 2em 1.5em 2em',
                      minWidth: 320,
                      maxWidth: 400,
                      flex: '1 1 340px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1.2em',
                    }}
                  >
                    <div className="workspace-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <Slack size={28} color="#4f46e5" />
                      <span className="workspace-title" style={{ fontSize: '1.25rem', fontWeight: 600, color: '#23272f' }}>{connection.slackTeamName}</span>
                    </div>
                    {loadingSaved || loadingChannelsInfo ? (
                      <div className="loading-configured" style={{ color: '#64748b' }}>Loading configured channels/DMs...</div>
                    ) : savedChannels && (savedChannels.selectedChannels.length > 0 || savedChannels.selectedDMs.length > 0) ? (
                      <div className="channels-dms-lists" style={{ display: 'flex', gap: '2em', flexWrap: 'wrap' }}>
                        {savedChannels.selectedChannels.length > 0 && (
                          <div className="channels-list-ui" style={{ flex: 1 }}>
                            <div className="list-title" style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: '#475569', marginBottom: 8 }}><Hash size={18} color="#0ea5e9" style={{marginRight: 6}} />Channels</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
                              {savedChannels.selectedChannels.map((ch) => (
                                <span key={ch} className="channel-list-item" style={{ background: '#e0e7ef', color: '#334155', borderRadius: '999px', padding: '0.35em 1em', fontWeight: 500, fontSize: '1em', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                  <Hash size={14} style={{marginRight: 2}} />{channelMap[ch] ? `${channelMap[ch]}` : ch}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {savedChannels.selectedDMs.length > 0 && (
                          <div className="dms-list-ui" style={{ flex: 1 }}>
                            <div className="list-title" style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: '#475569', marginBottom: 8 }}><User size={18} color="#f59e42" style={{marginRight: 6}} />Direct Messages</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
                              {savedChannels.selectedDMs.map((dm) => (
                                <span key={dm} className="dm-list-item" style={{ background: '#fef3c7', color: '#b45309', borderRadius: '999px', padding: '0.35em 1em', fontWeight: 500, fontSize: '1em', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                  <User size={14} style={{marginRight: 2}} />{dmMap[dm] ? dmMap[dm] : dm}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="empty-configured" style={{ color: '#64748b', fontStyle: 'italic', marginTop: 12 }}>No channels or DMs configured yet for this workspace.</div>
                    )}
                  </div>
                );
              })}
            </div>
            {connections.every((conn, idx) => {
              const savedChannels = savedChannelsQueries[idx]?.data;
              return !savedChannels || (savedChannels.selectedChannels.length === 0 && savedChannels.selectedDMs.length === 0);
            }) && (
              <div className="empty-configured-global" style={{ textAlign: 'center', marginTop: '3em', color: '#64748b' }}>
                <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4ac.png" alt="No channels" style={{ width: 64, marginBottom: 16, opacity: 0.7 }} />
                <div style={{ fontSize: '1.1em' }}>You have not configured any channels or DMs yet.<br />Use the button above to get started!</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (connectionsLoading) {
    return (
      <div className="loading">
        <span className="spinner" />
        Loading dashboard...
      </div>
    );
  }

  const hasConnections = connections && connections.length > 0;
  const hasSummary = summary && summary.topTasks && summary.topTasks.length > 0;
  const stats = dashboardStats?.stats || {};

  // Debug info for admin
  console.log('Dashboard Debug Info:', {
    isAdmin,
    user: user,
    allChannelSelections,
    allChannelSelectionsLoading,
    hasConnections
  });

  return (
    <div className="dashboard">
      {/* <div className="dashboard-header">
        <div className="header-content">
          <div>
            <h1>Dashboard</h1>
            <p>Overview of your automation discovery progress</p>
          </div>
          <button
            className="save-conversation-btn"
            onClick={() => setSaveDialogOpen(true)}
          >
            <Save size={20} />
            Save Conversation
          </button>
        </div>
      </div> */}

      {/* Debug Info for Admin */}
      {/* {isAdmin && (
        <div style={{
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          fontSize: '14px'
        }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#92400e' }}>🔧 Admin Debug Info:</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
            <div><strong>Admin Status:</strong> {isAdmin ? '✅ Yes' : '❌ No'}</div>
            <div><strong>User Role:</strong> {user?.role || 'None'}</div>
            <div><strong>Channel Selections Loading:</strong> {allChannelSelectionsLoading ? '🔄 Loading' : '✅ Loaded'}</div>
            <div><strong>Total Selections:</strong> {allChannelSelections?.selections?.length || 0}</div>
            <div><strong>Grouped Selections:</strong> {allChannelSelections?.groupedSelections?.length || 0}</div>
            <div><strong>Has Connections:</strong> {hasConnections ? '✅ Yes' : '❌ No'}</div>
          </div>
        </div>
      )} */}

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
          value={connections?.length || 0}
          label="My Connected Workspaces"
          accent="success"
          status={stats.totalActiveJobs ? `${stats.totalActiveJobs} active jobs` : undefined}
          statusColor="primary"
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
        {!hasConnections && !isAdmin ? (
          <div className="welcome-section">
            <div className="welcome-card">
              <h2>Welcome to AutoMiner!</h2>
              <p>
                Start by connecting your Slack workspace to begin discovering
                automation opportunities from your team conversations.
              </p>
              <Link to="/slack-connect" className="cta-button">
                <Plus size={20} />
                Connect Slack Workspace
              </Link>
            </div>
          </div>
        ) : (
          <div className="dashboard-grid">
              {/* Daily Message Chart */}

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





            {/* Enhanced Message Fetching Progress - Only show if there are connections */}
            {/* {hasConnections && (
              <div className="card large-card">
                <div className="card-header">
                  <h3>Message Fetching Progress</h3>
                  <div className="card-actions">
                    <Link to="/slack-connect" className="view-all-link">Configure</Link>
                  </div>
                </div>
              <div className="card-content">
                {progressLoading ? (
                  <div className="loading">Loading progress...</div>
                ) : overallProgress && overallProgress.length > 0 ? (
                  <div className="progress-overview">
                    {overallProgress.map(({ connection, progress }) => (
                      <div key={connection.id} className="connection-progress-card">
                        <div className="connection-info">
                          <h4>{connection.slackTeamName}</h4>
                          <div className="progress-stats">
                            <div className="stat">
                              <Database size={16} />
                              <span>{progress.stats.totalMessages.toLocaleString()} messages</span>
                            </div>
                            <div className="stat">
                              <Activity size={16} />
                              <span>
                                {progress.stats.channelCount !== undefined && progress.stats.dmCount !== undefined
                                  ? (progress.stats.channelCount > 0 && progress.stats.dmCount > 0
                                      ? `${progress.stats.channelCount} channels, ${progress.stats.dmCount} DMs`
                                      : progress.stats.channelCount > 0
                                        ? `${progress.stats.channelCount} channels`
                                        : progress.stats.dmCount > 0
                                          ? `${progress.stats.dmCount} DMs`
                                          : '0 conversations')
                                  : `${progress.stats.totalSelections || 0} conversations`
                                }
                              </span>
                            </div>
                            <div className="stat">
                              <CheckCircle size={16} />
                              <span>{progress.stats.completed} completed</span>
                            </div>
                          </div>
                        </div>
                        <div className="connection-actions">
                          <button
                            className="action-button history-export"
                            onClick={() => handleHistoryExport(connection.id)}
                            disabled={exportingHistory || queuedExportJobs[connection.id]}
                            title={queuedExportJobs[connection.id] ? "Export job is queued" : "Export all message history"}
                          >
                            {exportingHistory ? <Loader size={16} className="spinning" /> :
                             queuedExportJobs[connection.id] ? <Clock size={16} /> : <History size={16} />}
                            <span>{queuedExportJobs[connection.id] ? 'Queued' : 'Export History'}</span>
                          </button>

                          <div className="daily-export-toggle">
                            <span>Daily Export:</span>
                            <button
                              className={`toggle-button ${progress.stats.dailyExportEnabled ? 'enabled' : 'disabled'}`}
                              onClick={() => handleToggleDailyExport(connection.id, 'all', !progress.stats.dailyExportEnabled)}
                              disabled={togglingDaily}
                              title={`${progress.stats.dailyExportEnabled ? 'Disable' : 'Enable'} daily message fetching`}
                            >
                              {togglingDaily ? (
                                <Loader size={16} className="spinning" />
                              ) : progress.stats.dailyExportEnabled ? (
                                <ToggleRight size={16} />
                              ) : (
                                <ToggleLeft size={16} />
                              )}
                              <span>{progress.stats.dailyExportEnabled ? 'On' : 'Off'}</span>
                            </button>
                          </div>
                        </div>

                        {progress.isActive && (
                          <div className="active-indicator">
                            <div className="spinner"></div>
                            <span>Fetching...</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Database size={48} />
                    <p>No message fetching configured yet.</p>
                    <Link to="/slack-connect" className="cta-button">
                      Configure Channels
                    </Link>
                  </div>
                )}

                {dashboardStats?.dailyStats && (
                  <div className="daily-chart">
                    <h4>Messages Fetched (Last 7 Days)</h4>
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
            )} */}

            {/* Active Jobs */}
            {dashboardStats?.activeJobs && dashboardStats.activeJobs.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <h3>Currently Fetching</h3>
                  <span className="status-badge active">{dashboardStats.activeJobs.length} active</span>
                </div>
                <div className="card-content">
                  <div className="active-jobs">
                    {dashboardStats.activeJobs.map((job) => (
                      <div key={job.id} className="job-item">
                        <div className="job-info">
                          <h4>{job.slackConnection.slackTeamName}</h4>
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

            {/* Recent Analysis */}
            <div className="card">
              <div className="card-header">
                <h3>Recent Analysis</h3>
                <Link to="/analysis" className="view-all-link">View All</Link>
              </div>
              <div className="card-content">
                {hasSummary ? (
                  <div className="recent-tasks">
                    {summary.topTasks.slice(0, 5).map((task, index) => (
                      <div key={task.id} className="task-item">
                        <div className="task-rank">#{index + 1}</div>
                        <div className="task-info">
                          <p className="task-description">{task.taskDescription}</p>
                          <div className="task-meta">
                            <span className={`difficulty-badge ${task.difficulty}`}>
                              {task.difficulty}
                            </span>
                            <span className={`roi-badge ${task.estimatedRoi}`}>
                              {task.estimatedRoi} ROI
                            </span>
                            <span className="confidence-score">
                              {Math.round(task.confidence * 100)}% confidence
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Clock size={48} />
                    <p>No analysis results yet. Run your first analysis to see automation opportunities.</p>
                    <Link to="/analysis" className="secondary-button">
                      Run Analysis
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Connected Workspaces */}
            <div className="card">
              <div className="card-header">
                <h3>My Connected Workspaces</h3>
                <Link to="/slack-connect" className="view-all-link">Manage</Link>
              </div>
              <div className="card-content">
                <div className="workspaces-list">
                  {connections?.map((connection) => (
                    <div key={connection.id} className="workspace-card">
                      <div className="workspace-header">
                        <div className="workspace-icon">
                          <Slack size={22} />
                        </div>
                        <div>
                          <div className="workspace-name">{connection.slackTeamName}</div>
                          <div className="workspace-date">Connected {new Date(connection.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <span className={`workspace-status${connection.isActive ? '' : ' inactive'}`}>
                        {connection.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* All Users Channel Selections - Admin Only */}
            <div className="card large-card">
              <div className="card-header">
                <h3>All Users Channel Selections</h3>
                <span className="status-badge">
                  {allChannelSelections?.selections?.length || 0} total selections
                </span>
              </div>

              <div className="card-content">
                {allChannelSelectionsLoading ? (
                  <div className="loading">Loading all users' channel selections...</div>
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
                              <Slack size={16} />
                              <span className="workspace-name">{connectionData.connection.slackTeamName}</span>
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
                                  selection.status === 'completed' ||
                                  selection.status === 'pending' ||
                                  selection.status === 'running'
                                );

                                return (
                                  <div key={selection.id} className="channel-selection-item">
                                    <div className="channel-info">
                                      <div className="channel-icon">
                                        {selection.channelType === 'channel' ? <Hash size={14} /> : <User size={14} />}
                                      </div>
                                      <div className="channel-details">
                                        <span className="channel-name">
                                          {selection.channelName || selection.channelId}
                                        </span>
                                        <span className="channel-type">
                                          {selection.channelType === 'channel' ? 'Channel' : 'DM'}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="channel-actions">
                                      {/* History Export Button */}
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

                                      {/* Daily Export Toggle */}
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
                    <Database size={48} />
                    <p>No channel selections found across all users.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
              >
                ×
              </button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="Enter conversation title"
                />
              </div>
              <div className="form-group">
                <label>Content</label>
                <textarea
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
      <Snackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={() => setSnackbar(prev => ({ ...prev, isVisible: false }))}
      />
    </div>
  );
}

export default Dashboard;
