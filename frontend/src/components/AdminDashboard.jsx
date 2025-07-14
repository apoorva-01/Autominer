import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { Users, Activity, CheckCircle, XCircle, AlertCircle, Calendar, Database, Settings, Eye, EyeOff, Loader, Hash, MessageCircle, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './AdminDashboard.css';

// Progress Bar Component
const ProgressBar = ({ progress, status }) => {
  const getProgressColor = () => {
    if (status === 'failed') return '#f44336';
    if (status === 'completed') return '#4caf50';
    return '#2196f3';
  };

  return (
    <div className="progress-bar-container">
      <div 
        className={`progress-bar ${status}`} 
        style={{ 
          width: `${progress}%`,
          backgroundColor: getProgressColor()
        }}
      >
        {progress > 15 && <span className="progress-text">{progress}%</span>}
      </div>
      {progress <= 15 && <span className="progress-text-outside">{progress}%</span>}
    </div>
  );
};

// Format date helper
const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).format(date);
};

function AdminDashboard() {
  const { user, isAdmin } = useAuth();
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserDetails, setShowUserDetails] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [showChannels, setShowChannels] = useState(false);
  const queryClient = useQueryClient();
  const [deletingJobId, setDeletingJobId] = useState(null);
  
  // Fetch system stats
  const { data: stats, isLoading: statsLoading } = useQuery(
    'admin-stats',
    async () => {
      const response = await axios.get('/api/slack/admin/stats');
      return response.data;
    },
    { enabled: isAdmin }
  );

  // Fetch all users
  const { data: usersData, isLoading: usersLoading } = useQuery(
    'admin-users',
    async () => {
      const response = await axios.get('/api/slack/admin/users');
      return response.data;
    },
    { enabled: isAdmin }
  );

  // Fetch all connections
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery(
    'admin-connections',
    async () => {
      const response = await axios.get('/api/slack/admin/connections');
      return response.data;
    },
    { enabled: isAdmin }
  );

  // Fetch channels for selected connection
  const { data: channelsData, isLoading: channelsLoading } = useQuery(
    ['admin-channels', selectedConnection?.id],
    async () => {
      const response = await axios.get(`/api/slack/admin/users/${selectedConnection.userId}/connections/${selectedConnection.id}/channels`);
      return response.data;
    },
    { enabled: showChannels && selectedConnection }
  );

  // Fetch Google Drive status
  const { data: googleDriveStatus, isLoading: googleDriveLoading } = useQuery(
    'admin-google-drive',
    async () => {
      const response = await axios.get('/api/slack/google-docs/status');
      return response.data;
    },
    { enabled: isAdmin }
  );

  // Fetch all scraping jobs (admin only)
  const { data: jobsData, isLoading: jobsLoading } = useQuery(
    'admin-scraping-jobs',
    async () => {
      const response = await axios.get('/api/slack/admin/scraping-jobs');
      return response.data;
    },
    { enabled: isAdmin }
  );

  // Fetch all automation tasks (admin only, limit 100)
  const { data: tasksData, isLoading: tasksLoading } = useQuery(
    'admin-automation-tasks',
    async () => {
      const response = await axios.get('/api/analysis/results?limit=100');
      return response.data;
    },
    { enabled: isAdmin }
  );

  // Mutation for deleting a job
  const deleteJobMutation = useMutation(
    async (jobId) => {
      await axios.delete(`/api/slack/admin/scraping-jobs/${jobId}`);
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('admin-scraping-jobs');
        setDeletingJobId(null);
      },
      onError: () => {
        setDeletingJobId(null);
        alert('Failed to delete job.');
      }
    }
  );

  if (!isAdmin) {
    return (
      <div className="admin-dashboard">
        <div className="access-denied">
          <AlertCircle size={48} />
          <h2>Access Denied</h2>
          <p>You don't have permission to access the admin dashboard.</p>
        </div>
      </div>
    );
  }

  if (statsLoading || usersLoading || connectionsLoading) {
    return (
      <div className="admin-dashboard">
        <div className="loading">Loading admin dashboard...</div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      {/* <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <p>System overview and user management</p>
      </div> */}

      {/* System Stats */}
      {/* <div className="stats-section">
        <h2>System Statistics</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <MessageCircle size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats?.totalMessages?.toLocaleString() || 0}</h3>
              <p>Total Messages Fetched</p>
              {stats?.messagesLast24h > 0 && (
                <span className="stat-card__status stat-card__status--success">+{stats.messagesLast24h} in 24h</span>
              )}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <Users size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats?.totalUsers || 0}</h3>
              <p>Total Users</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <Activity size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats?.activeConnections || 0}</h3>
              <p>Active Slack Connections</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <Database size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats?.totalTasks || 0}</h3>
              <p>Total Tasks</p>
            </div>
          </div>
        </div>
      </div> */}

      {/* All Current Jobs/Tasks Section */}
      <div className="jobs-tasks-section">
        <div className="card jobs-list-section">
          <div className="section-header">
            <AlertCircle className="section-icon" size={28} color="#4f8cff" />
            <h2>All Current Jobs & Tasks</h2>
          </div>
          <div className="subsection-header">
            <Hash className="subsection-icon" size={20} color="#4f8cff" />
            <h3>Scraping Jobs</h3>
          </div>
          {jobsData && (jobsData.jobs?.length > 0 || jobsData.completedJobs?.length > 0) && (
            <div className="jobs-summary">
              <div className="summary-stats">
                <div className="summary-stat">
                  <span className="summary-label">Total Messages:</span>
                  <span className="summary-value">
                    {(jobsData.jobs?.reduce((sum, job) => sum + (job.messagesScraped || 0), 0) || 0) + 
                     (jobsData.completedJobs?.reduce((sum, job) => sum + (job.messagesScraped || 0), 0) || 0)}
                  </span>
                </div>
                <div className="summary-stat">
                  <span className="summary-label">Active Jobs:</span>
                  <span className="summary-value">{jobsData.jobs?.length || 0}</span>
                </div>
                <div className="summary-stat">
                  <span className="summary-label">Completed Jobs:</span>
                  <span className="summary-value">{jobsData.completedJobs?.length || 0}</span>
                </div>
              </div>
            </div>
          )}
          {jobsLoading ? (
            <div className="loading-container">
              <Loader size={24} className="spin" />
              <span>Loading jobs...</span>
            </div>
          ) : jobsData && jobsData.jobs ? (
            <>
              <div className="table-responsive">
                <table className="jobs-table zebra">
                  <thead>
                    <tr>
                      {/* <th>Job ID</th> */}
                      <th>Workspace</th>
                      <th>Channel</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Messages</th>
                      <th>Started</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobsData.jobs.map(job => (
                      <tr key={job.id} className="table-row-hover">
                        {/* <td className="mono job-id" title={job.id}>{job.id.slice(0, 8)}...</td> */}
                        <td className="workspace-cell">{job.slackConnection?.slackTeamName || '-'}</td>
                        <td className="channel-cell" title={job.channelId}>
                          <div className="channel-name-container">
                            {job.channelName || job.channelId}
                          </div>
                        </td>
                        <td className="type-cell">
                          <div className="channel-type-badge">
                            {job.channelType === 'channel' ? <Hash size={14} /> : <MessageCircle size={14} />} 
                            <span>{job.channelType}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-badge status-${job.status}`}>
                            {job.status === 'running' && <Loader size={14} className="spin" />} 
                            {job.status === 'failed' && <XCircle size={14} />} 
                            {job.status === 'completed' && <CheckCircle size={14} />} 
                            <span>{job.status}</span>
                          </span>
                        </td>
                        <td className="progress-cell">
                          <ProgressBar progress={job.progress} status={job.status} />
                        </td>
                        <td className="messages-count">{job.messagesScraped.toLocaleString()}</td>
                        <td>{formatDate(job.startedAt)}</td>
                        <td>{formatDate(job.updatedAt)}</td>
                        <td>
                          <button
                            className="delete-job-btn"
                            disabled={deletingJobId === job.id || deleteJobMutation.isLoading}
                            title="Delete job"
                            onClick={() => {
                              if (window.confirm('Are you sure you want to delete this job?')) {
                                setDeletingJobId(job.id);
                                deleteJobMutation.mutate(job.id);
                              }
                            }}
                          >
                            {deletingJobId === job.id ? <Loader size={14} className="spin" /> : <Trash2 size={16} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="subsection-header completed-jobs-header">
                <CheckCircle className="subsection-icon" size={20} color="#388e3c" />
                <h4>Completed Jobs</h4>
              </div>
              {jobsData.completedJobs && jobsData.completedJobs.length > 0 ? (
                <div className="table-responsive">
                  <table className="jobs-table zebra completed">
                    <thead>
                      <tr>
                        {/* <th>Job ID</th> */}
                        <th>Workspace</th>
                        <th>Channel</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Messages</th>
                        <th>Started</th>
                        <th>Completed</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobsData.completedJobs.map(job => (
                        <tr key={job.id} className="table-row-hover">
                          {/* <td className="mono job-id" title={job.id}>{job.id.slice(0, 8)}...</td> */}
                          <td className="workspace-cell">{job.slackConnection?.slackTeamName || '-'}</td>
                          <td className="channel-cell" title={job.channelId}>
                            <div className="channel-name-container">
                              {job.channelName || job.channelId}
                            </div>
                          </td>
                          <td className="type-cell">
                            <div className="channel-type-badge">
                              {job.channelType === 'channel' ? <Hash size={14} /> : <MessageCircle size={14} />} 
                              <span>{job.channelType}</span>
                            </div>
                          </td>
                          <td>
                            <span className="status-badge status-completed">
                              <CheckCircle size={14} /> 
                              <span>completed</span>
                            </span>
                          </td>
                          <td className="progress-cell">
                            <ProgressBar progress={job.progress} status={job.status} />
                          </td>
                          <td className="messages-count">{job.messagesScraped.toLocaleString()}</td>
                          <td>{formatDate(job.startedAt)}</td>
                          <td>{formatDate(job.completedAt)}</td>
                          <td>
                            <button
                              className="delete-job-btn"
                              disabled={deletingJobId === job.id || deleteJobMutation.isLoading}
                              title="Delete job"
                              onClick={() => {
                                if (window.confirm('Are you sure you want to delete this completed job?')) {
                                  setDeletingJobId(job.id);
                                  deleteJobMutation.mutate(job.id);
                                }
                              }}
                            >
                              {deletingJobId === job.id ? <Loader size={14} className="spin" /> : <Trash2 size={16} />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No completed jobs found.</div>
              )}
            </>
          ) : (
            <div className="empty-state">No scraping jobs found.</div>
          )}
        </div>
        <div className="card tasks-list-section">
          <div className="subsection-header">
            <Activity className="subsection-icon" size={20} color="#ff9800" />
            <h3>Automation Tasks</h3>
          </div>
          {tasksLoading ? (
            <div className="loading-container">
              <Loader size={24} className="spin" />
              <span>Loading tasks...</span>
            </div>
          ) : tasksData && tasksData.tasks && tasksData.tasks.length > 0 ? (
            <div className="table-responsive">
              <table className="tasks-table zebra">
                <thead>
                  <tr>
                    <th>Task ID</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Confidence</th>
                    <th>Workspace</th>
                    <th>Channel</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksData.tasks.map(task => (
                    <tr key={task.id} className="table-row-hover">
                      <td className="mono job-id" title={task.id}>{task.id.slice(0, 8)}...</td>
                      <td>{task.taskDescription}</td>
                      <td>
                        <span className={`status-badge status-${task.status}`}>
                          {task.status === 'completed' && <CheckCircle size={14} />} 
                          {task.status === 'failed' && <XCircle size={14} />} 
                          {task.status === 'running' && <Loader size={14} className="spin" />} 
                          <span>{task.status}</span>
                        </span>
                      </td>
                      <td>
                        <div className="confidence-bar-container">
                          <div 
                            className="confidence-bar" 
                            style={{ width: `${Math.round(task.confidence * 100)}%` }}
                          ></div>
                          <span>{Math.round(task.confidence * 100)}%</span>
                        </div>
                      </td>
                      <td>{task.slackConversation?.slackConnection?.slackTeamName || '-'}</td>
                      <td title={task.slackConversation?.channelId}>{task.slackConversation?.channelName || '-'}</td>
                      <td>{formatDate(task.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">No automation tasks found.</div>
          )}
        </div>
      </div>

      {/* Users Overview */}
      <div className="users-section">
        <h2>Users Overview</h2>
        <div className="users-grid">
          {usersData?.users?.map((user) => (
            <div key={user.id} className="user-card">
              <div className="user-header">
                <div className="user-info">
                  <h3>{user.name || user.email}</h3>
                  <p className="user-email">{user.email}</p>
                  <span className={`role-badge ${user.role}`}>
                    {user.role}
                  </span>
                </div>
                <div className="user-actions">
                  <button
                    onClick={() => {
                      setSelectedUser(user);
                      setShowUserDetails(true);
                    }}
                    className="view-details-btn"
                  >
                    <Eye size={16} />
                    View Details
                  </button>
                </div>
              </div>
              <div className="user-stats">
                <div className="stat-item">
                  <span className="stat-label">Connections:</span>
                  <span className="stat-value">{user.slackConnections?.length || 0}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Joined:</span>
                  <span className="stat-value">{new Date(user.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              {user.slackConnections?.length > 0 && (
                <div className="user-connections">
                  <h4>Slack Workspaces:</h4>
                  {user.slackConnections.map((connection) => (
                    <div key={connection.id} className="connection-item">
                      <div className="connection-info">
                        <span className="connection-name">{connection.slackTeamName}</span>
                        <span className={`connection-status ${connection.isActive ? 'active' : 'inactive'}`}>
                          {connection.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedConnection({ ...connection, userId: user.id });
                          setShowChannels(true);
                        }}
                        className="view-channels-btn"
                      >
                        <Settings size={14} />
                        View Channels
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
          {/* Google Drive Integration */}
          <div className="google-drive-section">
        <h2>Google Drive Integration</h2>
        <div className="google-drive-status">
          {googleDriveLoading ? (
            <div className="loading">Loading Google Drive status...</div>
          ) : googleDriveStatus ? (
            <div className="drive-status-card">
              <div className="status-header">
                <h3>Integration Status</h3>
                <span className={`status-badge ${googleDriveStatus.isConfigured ? 'configured' : 'not-configured'}`}>
                  {googleDriveStatus.isConfigured ? 'Configured' : 'Not Configured'}
                </span>
              </div>
              <div className="status-details">
                <div className="detail-item">
                  <span className="detail-label">Service Type:</span>
                  <span className="detail-value">{googleDriveStatus.serviceType || 'Not configured'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Root Folder:</span>
                  <span className="detail-value">{googleDriveStatus.rootFolderName || 'Not set'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Auth Status:</span>
                  <span className="detail-value">{googleDriveStatus.authStatus || 'Unknown'}</span>
                </div>
                {googleDriveStatus.error && (
                  <div className="error-detail">
                    <span className="detail-label">Error:</span>
                    <span className="detail-value error">{googleDriveStatus.error}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="drive-status-card">
              <div className="status-header">
                <h3>Google Drive Not Available</h3>
                <span className="status-badge not-configured">Not Configured</span>
              </div>
              <p>Google Drive integration is not configured or not available.</p>
            </div>
          )}
        </div>
      </div>

      {/* User Details Modal */}
      {showUserDetails && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowUserDetails(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedUser.name || selectedUser.email}</h2>
              <button
                className="close-button"
                onClick={() => setShowUserDetails(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-content">
              <div className="user-details">
                <div className="detail-row">
                  <span className="detail-label">Email:</span>
                  <span className="detail-value">{selectedUser.email}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Role:</span>
                  <span className={`role-badge ${selectedUser.role}`}>
                    {selectedUser.role}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Joined:</span>
                  <span className="detail-value">{new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Slack Connections:</span>
                  <span className="detail-value">{selectedUser.slackConnections?.length || 0}</span>
                </div>
              </div>
              {selectedUser.slackConnections?.length > 0 && (
                <div className="user-connections-detailed">
                  <h3>Slack Workspaces</h3>
                  {selectedUser.slackConnections.map((connection) => (
                    <div key={connection.id} className="connection-detailed">
                      <div className="connection-header">
                        <h4>{connection.slackTeamName}</h4>
                        <span className={`connection-status ${connection.isActive ? 'active' : 'inactive'}`}>
                          {connection.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="connection-details">
                        <p><strong>Team ID:</strong> {connection.slackTeamId}</p>
                        <p><strong>Connected:</strong> {new Date(connection.createdAt).toLocaleDateString()}</p>
                        <p><strong>Scopes:</strong> {connection.scopes?.join(', ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Channels Modal */}
      {showChannels && selectedConnection && (
        <div className="modal-overlay" onClick={() => setShowChannels(false)}>
          <div className="modal large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Channels & DMs - {selectedConnection.slackTeamName}</h2>
              <button
                className="close-button"
                onClick={() => setShowChannels(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-content">
              {channelsLoading ? (
                <div className="loading">Loading channels...</div>
              ) : (
                <div className="channels-overview">
                  <div className="channels-stats">
                    <div className="stat-item">
                      <span className="stat-label">Channels:</span>
                      <span className="stat-value">{channelsData?.channels?.length || 0}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">DMs:</span>
                      <span className="stat-value">{channelsData?.dms?.length || 0}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Total:</span>
                      <span className="stat-value">{channelsData?.totalCount || 0}</span>
                    </div>
                  </div>
                  
                  {channelsData?.channels?.length > 0 && (
                    <div className="channels-list">
                      <h3>Channels</h3>
                      <div className="channels-grid">
                        {channelsData.channels.map((channel) => (
                          <div key={channel.id} className="channel-item">
                            <div className="channel-info">
                              <h4>#{channel.name}</h4>
                              <p>{channel.purpose || 'No description'}</p>
                              <div className="channel-meta">
                                <span className="member-count">{channel.memberCount} members</span>
                                <span className={`privacy-badge ${channel.isPrivate ? 'private' : 'public'}`}>
                                  {channel.isPrivate ? 'Private' : 'Public'}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {channelsData?.dms?.length > 0 && (
                    <div className="dms-list">
                      <h3>Direct Messages</h3>
                      <div className="dms-grid">
                        {channelsData.dms.map((dm) => (
                          <div key={dm.id} className="dm-item">
                            <div className="dm-info">
                              <h4>{dm.name}</h4>
                              <span className="dm-type">{dm.type}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard; 