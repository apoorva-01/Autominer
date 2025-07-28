import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from 'react-query';
import axios from 'axios';
import { Activity, CheckCircle, XCircle, AlertCircle, Eye, Loader, Hash, MessageCircle, Trash2, UserMinus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal, Pencil } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import './AdminControlDashboard.css';
import Skeleton from '../common/Skeleton';
import SimpleSnackbar from '../common/SimpleSnackbar';

// Progress Bar Component
const ProgressBar = ({ progress, status }) => {

  return (
    <div className="progress-bar-container">
      <div 
        className={`progress-bar ${status}`} 
        style={{ width: `${progress}%` }}
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

// Confirmation Modal
function ConfirmModal({ open, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', loading }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <div className="modal-content">
          <p>{message}</p>
        </div>
        <div className="modal-actions" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onCancel} className="cancel-button">{cancelText}</button>
          <button onClick={onConfirm} className="submit-button" disabled={loading}>{loading ? 'Processing...' : confirmText}</button>
        </div>
      </div>
    </div>
  );
}

// Helper to render improved pagination
function Pagination({ page, setPage, total, pageSize, ariaLabel }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const maxButtons = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, start + maxButtons - 1);
  if (end - start < maxButtons - 1) start = Math.max(1, end - maxButtons + 1);
  const pageNumbers = [];
  for (let i = start; i <= end; i++) pageNumbers.push(i);
  return (
    <nav className="pagination-ui" aria-label={ariaLabel}>
      <button
        onClick={() => setPage(1)}
        disabled={page === 1}
        aria-label="First page"
        className="pagination-btn"
      >
        <ChevronsLeft size={16} />
      </button>
      <button
        onClick={() => setPage(p => Math.max(1, p - 1))}
        disabled={page === 1}
        aria-label="Previous page"
        className="pagination-btn"
      >
        <ChevronLeft size={16} />
      </button>
      {start > 1 && <span className="pagination-ellipsis"><MoreHorizontal size={16} /></span>}
      {pageNumbers.map(i => (
        <button
          key={i}
          onClick={() => setPage(i)}
          className={`pagination-btn${page === i ? ' active' : ''}`}
          aria-current={page === i ? 'page' : undefined}
        >
          {i}
        </button>
      ))}
      {end < totalPages && <span className="pagination-ellipsis"><MoreHorizontal size={16} /></span>}
      <button
        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
        disabled={page === totalPages}
        aria-label="Next page"
        className="pagination-btn"
      >
        <ChevronRight size={16} />
      </button>
      <button
        onClick={() => setPage(totalPages)}
        disabled={page === totalPages}
        aria-label="Last page"
        className="pagination-btn"
      >
        <ChevronsRight size={16} />
      </button>
    </nav>
  );
}

function AdminControlDashboard() {
  const { user, isAdmin } = useAuth();
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserDetails, setShowUserDetails] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [showChannels, setShowChannels] = useState(false);
  const queryClient = useQueryClient();
  const [deletingJobId, setDeletingJobId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  // Role management state
  const [section, setSection] = useState('dashboard'); // 'dashboard' or 'roles'

  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Modal state
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, loading: false });
  // Add state for selected automation task IDs and bulk deleting
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [bulkDeletingTasks, setBulkDeletingTasks] = useState(false);
  // Add state for selected user IDs and bulk deleting users
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [bulkDeletingUsers, setBulkDeletingUsers] = useState(false);
  // Add snackbar state for error messages
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: '' });
  
  // Auto-hide snackbar after 5 seconds
  useEffect(() => {
    if (snackbar.isVisible) {
      const timer = setTimeout(() => {
        setSnackbar(prev => ({ ...prev, isVisible: false }));
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [snackbar.isVisible]);

  // Pagination state
  const PAGE_SIZE = 5;
  const [jobsPage, setJobsPage] = useState(1);
  const [completedJobsPage, setCompletedJobsPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);
  const [channelsPage, setChannelsPage] = useState(1);
  const [dmsPage, setDmsPage] = useState(1);

  // Add tab state
  const [activeTab, setActiveTab] = useState('jobs'); // 'jobs', 'tasks', 'users'

  // Helper for paginated data - MOVED HERE BEFORE CONDITIONAL RETURNS
  const paginate = useMemo(() => (items, page, pageSize) => {
    if (!items) return [];
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, []);

  const [editingUser, setEditingUser] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRole, setEditUserRole] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [showEditUserPassword, setShowEditUserPassword] = useState(false);


  // Fetch system stats with lower frequency
  const { data: stats, isLoading: statsLoading } = useQuery(
    'admin-stats',
    async () => {
      const response = await axios.get('/api/admin/stats');
      return response.data;
    },
    { 
      enabled: isAdmin,
      staleTime: 60000, // Increased to 60 seconds
      cacheTime: 180000, // Increased to 3 minutes
      refetchOnWindowFocus: false
    }
  );

  // Fetch users with pagination directly from the API
  const { 
    data: usersData, 
    isLoading: usersLoading,
    fetchNextPage: fetchNextUsersPage,
    hasNextPage: hasNextUsersPage,
    isFetchingNextPage: isFetchingNextUsersPage,
    refetch: refetchUsers
  } = useInfiniteQuery(
    'admin-users',
    async ({ pageParam = 1 }) => {
      const response = await axios.get('/api/admin/users', {
        params: { page: pageParam, limit: PAGE_SIZE * 2 } // Fetch more than needed for smoother pagination
      });
      return response.data;
    },
    { 
      enabled: isAdmin && activeTab === 'users',
      getNextPageParam: (lastPage) => lastPage.nextPage || undefined,
      staleTime: 60000, // 60 seconds
      cacheTime: 120000, // 2 minutes
      refetchOnWindowFocus: false 
    }
  );

  // Memoize the flattened users data for better performance
  const flattenedUsers = useMemo(() => {
    if (!usersData?.pages) return [];
    return usersData.pages.flatMap(page => page.users || []);
  }, [usersData]);

  // Only fetch connections when needed (when users tab is active or when specifically looking at connections)
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery(
    'admin-connections',
    async () => {
      const response = await axios.get('/api/admin/connections');
      return response.data;
    },
    { 
      enabled: isAdmin && (activeTab === 'users' || selectedUser !== null),
      staleTime: 60000, // 60 seconds
      cacheTime: 120000, // 2 minutes
      refetchOnWindowFocus: false
    }
  );

  // Fetch channels for selected connection with pagination
  const { data: channelsData, isLoading: channelsLoading } = useQuery(
    ['admin-channels', selectedConnection?.id, channelsPage],
    async () => {
      const response = await axios.get(`/api/slack/admin/users/${selectedConnection.userId}/connections/${selectedConnection.id}/channels`, {
        params: { page: channelsPage, limit: PAGE_SIZE }
      });
      return response.data;
    },
    { 
      enabled: showChannels && selectedConnection !== null,
      keepPreviousData: true, // Keep displaying previous data while fetching new data
      staleTime: 120000, // 2 minutes
      cacheTime: 240000, // 4 minutes
      refetchOnWindowFocus: false
    }
  );

  // Fetch Google Drive status less frequently (it changes less often)
  const { data: googleDriveStatus, isLoading: googleDriveLoading } = useQuery(
    'admin-google-drive',
    async () => {
      const response = await axios.get('/api/slack/google-docs/status');
      return response.data;
    },
    { 
      enabled: isAdmin,
      staleTime: 300000, // 5 minutes
      cacheTime: 600000, // 10 minutes
      refetchOnWindowFocus: false
    }
  );

  // Fetch scraping jobs with pagination directly from the API
  const { data: jobsData, isLoading: jobsLoading } = useQuery(
    ['admin-scraping-jobs', jobsPage],
    async () => {
      const response = await axios.get('/api/slack/admin/scraping-jobs', {
        params: { page: jobsPage, limit: PAGE_SIZE * 2, includeStats: true }
      });
      return response.data;
    },
    { 
      enabled: isAdmin && activeTab === 'jobs',
      keepPreviousData: true, // Keep displaying previous data while fetching new data
      staleTime: 30000, // 30 seconds (keep this shorter as jobs change frequently)
      cacheTime: 60000, // 1 minute
      refetchOnWindowFocus: false
    }
  );

  // Fetch automation tasks with pagination directly from the API
  const { data: tasksData, isLoading: tasksLoading } = useQuery(
    ['admin-automation-tasks', tasksPage],
    async () => {
      const offset = (tasksPage - 1) * PAGE_SIZE;
      const response = await axios.get('/api/analysis/results', {
        params: { offset, limit: PAGE_SIZE }
      });
      return response.data;
    },
    { 
      enabled: isAdmin && activeTab === 'tasks',
      keepPreviousData: true,
      staleTime: 60000, // 1 minute
      cacheTime: 120000, // 2 minutes
      refetchOnWindowFocus: false
    }
  );

  // Mutation for deleting a job
  const deleteJobMutation = useMutation(
    async (jobId) => {
      try {
        // Note: This endpoint might still be under /api/slack/ if it's related to Slack functionality
        const response = await axios.delete(`/api/slack/admin/scraping-jobs/${jobId}`);
        return response.data;
      } catch (error) {
        console.error("Error deleting job:", error);
        throw error;
      }
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('admin-scraping-jobs');
        queryClient.invalidateQueries('admin-stats');
        setDeletingJobId(null);
        setSnackbar({ isVisible: true, message: 'Job deleted successfully.', type: 'success' });
      },
      onError: (error) => {
        console.error("Delete job mutation error:", error);
        setDeletingJobId(null);
        setSnackbar({ 
          isVisible: true, 
          message: `Failed to delete job: ${error?.response?.data?.message || error.message || 'Unknown error'}`,
          type: 'error' 
        });
      }
    }
  );

  // Mutation for deleting a user
  const deleteUserMutation = useMutation(
    async (userId) => {
      try {
        // Fix: Using the correct API endpoint /api/admin/users/:userId
        const response = await axios.delete(`/api/admin/users/${userId}`);
        return response.data;
      } catch (error) {
        console.error("Error deleting user:", error);
        throw error;
      }
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('admin-users');
        queryClient.invalidateQueries('admin-stats');
        setDeletingUserId(null);
        setSnackbar({ isVisible: true, message: 'User deleted successfully.', type: 'success' });
      },
      onError: (error) => {
        console.error("Delete user mutation error:", error);
        setDeletingUserId(null);
        setSnackbar({ 
          isVisible: true, 
          message: `Failed to delete user: ${error?.response?.data?.message || error.message || 'Unknown error'}`, 
          type: 'error' 
        });
      }
    }
  );

  // Mutation for deleting an automation task
  const deleteTaskMutation = useMutation(
    async (taskId) => {
      await axios.delete(`/api/analysis/tasks/${taskId}`);
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('admin-automation-tasks');
        setSnackbar({ isVisible: true, message: 'Task deleted successfully.', type: 'success' });
      },
      onError: () => {
        setSnackbar({ isVisible: true, message: 'Failed to delete task.', type: 'error' });
      }
    }
  );

  // Remove Role and Department management state and logic
  // Remove all code related to section === 'roles' and section === 'departments'
  // Only keep dashboard section and related state/logic

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
        {/* Mimic stats grid */}
        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5em', marginBottom: '2em' }}>
          <Skeleton width="100%" height="90px" shape="rounded" />
          <Skeleton width="100%" height="90px" shape="rounded" />
          <Skeleton width="100%" height="90px" shape="rounded" />
          <Skeleton width="100%" height="90px" shape="rounded" />
        </div>
        {/* Tab skeletons */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Skeleton width="140px" height="36px" shape="rounded" />
          <Skeleton width="180px" height="36px" shape="rounded" />
          <Skeleton width="160px" height="36px" shape="rounded" />
        </div>
        {/* Mimic jobs/tasks/users cards */}
        <div style={{ display: 'flex', gap: '2em', marginBottom: '2em' }}>
          <div className="card jobs-list-section" style={{ flex: 1, padding: '2em' }}>
            <Skeleton width="180px" height="2em" style={{ marginBottom: 24 }} shape="rounded" />
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} width="100%" height="32px" style={{ marginBottom: 12 }} shape="rounded" />
            ))}
          </div>
          <div className="card tasks-list-section" style={{ flex: 1, padding: '2em' }}>
            <Skeleton width="180px" height="2em" style={{ marginBottom: 24 }} shape="rounded" />
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} width="100%" height="32px" style={{ marginBottom: 12 }} shape="rounded" />
            ))}
          </div>
        </div>
        {/* Mimic users grid */}
        <div className="users-section">
          <Skeleton width="220px" height="2em" style={{ marginBottom: 24 }} shape="rounded" />
          <div className="users-grid" style={{ display: 'flex', gap: '1.5em' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ flex: 1 }}>
                <Skeleton width="100%" height="120px" shape="rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>

    
    <div className="admin-dashboard">
      {/* Tab Navigation */}
      <div className="admin-tabs">
        <button
          className={`admin-tab-btn${activeTab === 'jobs' ? ' active' : ''}`}
          onClick={() => setActiveTab('jobs')}
          data-tab="jobs"
        >
          All Current Jobs & Tasks
        </button>
        <button
          className={`admin-tab-btn${activeTab === 'tasks' ? ' active' : ''}`}
          onClick={() => setActiveTab('tasks')}
          data-tab="tasks"
        >
          Automation Tasks
        </button>
        <button
          className={`admin-tab-btn${activeTab === 'users' ? ' active' : ''}`}
          onClick={() => setActiveTab('users')}
          data-tab="users"
        >
          Users Overview
        </button>
      </div>
      {/* Tab Content */}
      {activeTab === 'jobs' && (
        <div className="jobs-tasks-section">
          {/* All Current Jobs/Tasks Section */}
          <div className="card jobs-list-section">
            {/* <div className="section-header">
              <h2>All Current Jobs & Tasks</h2>
            </div> */}
            <div className="subsection-header">
              <Hash className="subsection-icon" size={30} color="#4f8cff" />
              <h3>Scraping Jobs</h3>
            </div>
            {jobsData && (jobsData.jobs?.length > 0 || jobsData.completedJobs?.length > 0) && (
              <div className="jobs-summary">
                <div className="summary-stats">
                  <div className="summary-stat">
                    <span className="summary-label">Total Messages</span>
                    <span className="summary-value">
                      {new Intl.NumberFormat().format(
                        (jobsData.jobs?.reduce((sum, job) => sum + (job.messagesScraped || 0), 0) || 0) + 
                        (jobsData.completedJobs?.reduce((sum, job) => sum + (job.messagesScraped || 0), 0) || 0)
                      )}
                    </span>
                  </div>
                  <div className="summary-stat">
                    <span className="summary-label">Active Jobs</span>
                    <span className="summary-value">{jobsData.jobs?.length || 0}</span>
                  </div>
                  <div className="summary-stat">
                    <span className="summary-label">Completed Jobs</span>
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
                        <th>
                          <input
                            type="checkbox"
                            checked={jobsData.jobs.length > 0 && selectedJobIds.length === jobsData.jobs.length}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedJobIds(jobsData.jobs.map(job => job.id));
                              } else {
                                setSelectedJobIds([]);
                              }
                            }}
                            aria-label="Select all jobs"
                          />
                        </th>
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
                      {paginate(jobsData.jobs, jobsPage, PAGE_SIZE).map(job => {
                        // Debug: Log the progress value for each job
                        // console.log('Job progress:', job.id, job.progress);
                        // Ensure progress is a number between 0 and 100
                        const safeProgress = typeof job.progress === 'number' && !isNaN(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0;
                        return (
                          <tr key={job.id} className="table-row-hover">
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedJobIds.includes(job.id)}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedJobIds(prev => [...prev, job.id]);
                                  } else {
                                    setSelectedJobIds(prev => prev.filter(id => id !== job.id));
                                  }
                                }}
                                aria-label={`Select job ${job.id}`}
                              />
                            </td>
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
                              <ProgressBar progress={safeProgress} status={job.status} />
                            </td>
                            <td className="messages-count">{job.messagesScraped.toLocaleString()}</td>
                            <td>{formatDate(job.startedAt)}</td>
                            <td>{formatDate(job.updatedAt)}</td>
                            <td>
                              <button
                                className="delete-job-btn"
                                disabled={deletingJobId === job.id || deleteJobMutation.isLoading}
                                title="Delete job"
                                onClick={() => setConfirmModal({
                                  open: true,
                                  title: 'Delete Job',
                                  message: 'Are you sure you want to delete this job?',
                                  onConfirm: async () => {
                                    setDeletingJobId(job.id);
                                    await deleteJobMutation.mutateAsync(job.id);
                                    setDeletingJobId(null);
                                  },
                                  loading: false
                                })}
                              >
                                {deletingJobId === job.id ? <Loader size={14} className="spin" /> : <Trash2 size={16} />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {selectedJobIds.length > 0 && (
                  <div className="bulk-actions">
                    <button
                      className="delete-job-btn bulk-delete-btn"
                      disabled={bulkDeleting || deleteJobMutation.isLoading}
                      onClick={() => setConfirmModal({
                        open: true,
                        title: 'Delete Selected Jobs',
                        message: `Are you sure you want to delete ${selectedJobIds.length} selected job(s)?`,
                        onConfirm: async () => {
                          setBulkDeleting(true);
                          for (const jobId of selectedJobIds) {
                            await deleteJobMutation.mutateAsync(jobId);
                          }
                          setBulkDeleting(false);
                          setSelectedJobIds([]);
                        },
                        loading: false
                      })}
                    >
                      {bulkDeleting ? <Loader size={16} className="spin" /> : <Trash2 size={16} />} Delete Selected
                    </button>
                    <span className="selection-count">{selectedJobIds.length} selected</span>
                  </div>
                )}

                {jobsData.jobs.length > PAGE_SIZE && (
                  <Pagination
                    page={jobsPage}
                    setPage={setJobsPage}
                    total={jobsData.jobs.length}
                    pageSize={PAGE_SIZE}
                    ariaLabel="Jobs pagination"
                  />
                )}

                <div className="subsection-header completed-jobs-header">
                  <CheckCircle className="subsection-icon" size={30} color="#388e3c" />
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
                        {paginate(jobsData.completedJobs, completedJobsPage, PAGE_SIZE).map(job => {
                          // Debug: Log the progress value for each completed job
                          // console.log('Completed Job progress:', job.id, job.progress);
                          // Ensure progress is a number between 0 and 100
                          const safeProgress = typeof job.progress === 'number' && !isNaN(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0;
                          return (
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
                                <ProgressBar progress={safeProgress} status={job.status} />
                              </td>
                              <td className="messages-count">{job.messagesScraped.toLocaleString()}</td>
                              <td>{formatDate(job.startedAt)}</td>
                              <td>{formatDate(job.completedAt)}</td>
                              <td>
                                <button
                                  className="delete-job-btn"
                                  disabled={deletingJobId === job.id || deleteJobMutation.isLoading}
                                  title="Delete job"
                                  onClick={() => setConfirmModal({
                                    open: true,
                                    title: 'Delete Completed Job',
                                    message: 'Are you sure you want to delete this completed job?',
                                    onConfirm: async () => {
                                      setDeletingJobId(job.id);
                                      await deleteJobMutation.mutateAsync(job.id);
                                      setDeletingJobId(null);
                                    },
                                    loading: false
                                  })}
                                >
                                  {deletingJobId === job.id ? <Loader size={14} className="spin" /> : <Trash2 size={16} />}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">No completed jobs found.</div>
                )}
                {jobsData.completedJobs.length > PAGE_SIZE && (
                  <Pagination
                    page={completedJobsPage}
                    setPage={setCompletedJobsPage}
                    total={jobsData.completedJobs.length}
                    pageSize={PAGE_SIZE}
                    ariaLabel="Completed jobs pagination"
                  />
                )}
              </>
            ) : (
              <div className="empty-state">No scraping jobs found.</div>
            )}
          </div>
      
        </div>
      )}
      {activeTab === 'tasks' && (
        <div className="tasks-section">
          {/* Automation Tasks Section Only */}
          <div className="card tasks-list-section">
            <div className="subsection-header">
              <Activity className="subsection-icon" size={30} color="#ff9800" />
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
                      <th>
                        <input
                          type="checkbox"
                          checked={tasksData.tasks.length > 0 && selectedTaskIds.length === tasksData.tasks.length}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedTaskIds(tasksData.tasks.map(task => task.id));
                            } else {
                              setSelectedTaskIds([]);
                            }
                          }}
                          aria-label="Select all tasks"
                        />
                      </th>
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
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.includes(task.id)}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedTaskIds(prev => [...prev, task.id]);
                              } else {
                                setSelectedTaskIds(prev => prev.filter(id => id !== task.id));
                              }
                            }}
                            aria-label={`Select task ${task.id}`}
                          />
                        </td>
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
                {selectedTaskIds.length > 0 && (
                  <div className="bulk-actions">
                    <button
                      className="delete-job-btn bulk-delete-btn"
                      disabled={bulkDeletingTasks}
                      onClick={() => setConfirmModal({
                        open: true,
                        title: 'Delete Selected Tasks',
                        message: `Are you sure you want to delete ${selectedTaskIds.length} selected task(s)?`,
                        onConfirm: async () => {
                          setBulkDeletingTasks(true);
                          for (const taskId of selectedTaskIds) {
                            await deleteTaskMutation.mutateAsync(taskId);
                          }
                          setBulkDeletingTasks(false);
                          setSelectedTaskIds([]);
                        },
                        loading: false
                      })}
                    >
                      {bulkDeletingTasks ? <Loader size={16} className="spin" /> : <Trash2 size={16} />} Delete Selected
                    </button>
                    <span className="selection-count">{selectedTaskIds.length} selected</span>
                  </div>
                )}
                {tasksData.pagination && tasksData.pagination.total > PAGE_SIZE && (
                  <Pagination
                    page={tasksPage}
                    setPage={setTasksPage}
                    total={tasksData.pagination.total}
                    pageSize={PAGE_SIZE}
                    ariaLabel="Tasks pagination"
                  />
                )}
              </div>
            ) : (
              <div className="empty-state">No automation tasks found.</div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'users' && (
        <div className="users-section">
          {/* Users Overview Section as Table */}
          <h2>Users Overview</h2>
          <div className="table-responsive">
            <table className="users-table zebra">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={flattenedUsers?.length > 0 && selectedUserIds.length === paginate(flattenedUsers, usersPage, PAGE_SIZE).length}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedUserIds(paginate(flattenedUsers, usersPage, PAGE_SIZE).map(user => user.id));
                        } else {
                          setSelectedUserIds([]);
                        }
                      }}
                      aria-label="Select all users"
                    />
                  </th>
                  <th>Name / Email</th>
                  <th>Role</th>
                  <th>Connections</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginate(flattenedUsers, usersPage, PAGE_SIZE).map((user) => (
                  <tr key={user.id} className="table-row-hover">
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedUserIds(prev => [...prev, user.id]);
                          } else {
                            setSelectedUserIds(prev => prev.filter(id => id !== user.id));
                          }
                        }}
                        aria-label={`Select user ${user.id}`}
                      />
                    </td>
                    <td>{user.name || user.email}</td>
                    <td>
                      <span className={`role-badge ${user.role}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>{user.slackConnections?.length || 0}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setShowUserDetails(true);
                        }}
                        className="view-details-btn"
                      >
                        <Eye size={16} /> View
                      </button>
                      {/* Edit icon only, no button or text, matching delete style */}
                      <span
                        className="edit-user-icon-btn"
                        title="Edit user"
                        tabIndex={0}
                        aria-label="Edit user"
                        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: '#7c4dff' }}
                        onClick={() => {
                          setEditingUser(user);
                          setEditUserName(user.name || '');
                          setEditUserRole(user.role || '');
                          setEditUserEmail(user.email || '');
                          setEditUserPassword('');
                          setShowEditUserPassword(false);
                          setEditModalOpen(true);
                        }}
                      >
                        <Pencil size={16} />
                      </span>
                      <button
                        className="delete-user-icon-btn"
                        disabled={deletingUserId === user.id || deleteUserMutation.isLoading}
                        title="Delete user"
                        onClick={() => setConfirmModal({
                          open: true,
                          title: 'Delete User',
                          message: 'Are you sure you want to delete this user? This action cannot be undone.',
                          onConfirm: async () => {
                            setDeletingUserId(user.id);
                            await deleteUserMutation.mutateAsync(user.id);
                            setDeletingUserId(null);
                          },
                          loading: false
                        })}
                        tabIndex={0}
                        aria-label="Delete user"
                      >
                        {deletingUserId === user.id ? <Loader size={16} className="spin" /> : <Trash2 size={16} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selectedUserIds.length > 0 && (
              <div className="bulk-actions">
                <button
                  className="delete-job-btn bulk-delete-btn"
                  disabled={bulkDeletingUsers}
                  onClick={() => setConfirmModal({
                    open: true,
                    title: 'Delete Selected Users',
                    message: `Are you sure you want to delete ${selectedUserIds.length} selected user(s)? This action cannot be undone.`,
                    onConfirm: async () => {
                      setBulkDeletingUsers(true);
                      for (const userId of selectedUserIds) {
                        await deleteUserMutation.mutateAsync(userId);
                      }
                      setBulkDeletingUsers(false);
                      setSelectedUserIds([]);
                    },
                    loading: false
                  })}
                >
                  {bulkDeletingUsers ? <Loader size={16} className="spin" /> : <UserMinus size={16} />} Delete Selected
                </button>
                <span className="selection-count">{selectedUserIds.length} selected</span>
              </div>
            )}
          </div>
          {(flattenedUsers?.length || 0) > PAGE_SIZE && (
            <Pagination
              page={usersPage}
              setPage={setUsersPage}
              total={flattenedUsers?.length || 0}
              pageSize={PAGE_SIZE}
              ariaLabel="Users pagination"
            />
          )}
        </div>
      )}
  

      
     
 
    </div>


 {/* Snackbar for notifications */}
 <SimpleSnackbar
 message={snackbar.message}
 type={snackbar.type}
 isVisible={snackbar.isVisible}
 onClose={() => setSnackbar(prev => ({ ...prev, isVisible: false }))}
 duration={5000}
/>
        {/* Modals remain outside tab content so they can be triggered from any tab */}
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
              </div>
              {selectedUser.slackConnections?.length > 0 && (
                <div className="user-connections-detailed">
                  <div className="workspace-grid advanced">
                    {selectedUser.slackConnections.map((connection) => {
                      return (
                        <div key={connection.id} className="connection-detailed-card advanced">
                          <div className="connection-header advanced">
                            <div className="workspace-avatar advanced">
                              <span className="avatar-circle advanced">
                                <svg width="36" height="36" viewBox="0 0 36 36" style={{ verticalAlign: 'middle', transition: 'transform 0.2s' }}>
                                  <g>
                                    <circle cx="18" cy="18" r="18" fill="#611f69" />
                                    <text x="50%" y="55%" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold" dy=".3em">{connection.slackTeamName?.[0] || '?'}</text>
                                  </g>
                                </svg>
                              </span>
                            </div>
                            <div className="workspace-title-group advanced">
                              <h4 className="workspace-title advanced">{connection.slackTeamName}</h4>
                              <span className={`connection-status-chip ${connection.isActive ? 'active' : 'inactive'}`}
                                title={connection.isActive ? 'Active' : 'Inactive'}>
                                {connection.isActive ? (
                                  <>
                                    <span className="chip-dot active"></span>
                                    Active
                                  </>
                                ) : (
                                  <>
                                    <span className="chip-dot inactive"></span>
                                    Inactive
                                  </>
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="connection-details advanced">
                            <div className="detail-row advanced">
                              <span className="detail-label"><span role="img" aria-label="key"></span> Team ID:</span>
                              <span className="detail-value mono team-id-value advanced">{connection.slackTeamId}
                                <button
                                  className="copy-btn advanced"
                                  title="Copy Team ID"
                                  onClick={() => {
                                    navigator.clipboard.writeText(connection.slackTeamId);
                                    setSnackbar({ isVisible: true, message: 'Team ID copied!', type: 'success' });
                                  }}
                                >📋</button>
                              </span>
                            </div>
                            <div className="detail-row advanced">
                              <span className="detail-label"><span role="img" aria-label="calendar"></span> Connected:</span>
                              <span className="detail-value advanced">{new Date(connection.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

           {/* Edit User Modal */}
           {editModalOpen && editingUser && (
        <div className="modal-overlay" onClick={() => setEditModalOpen(false)}>
          <div className="modal edit-user-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit User</h2>
              <button className="modal-close-btn" onClick={() => setEditModalOpen(false)}>×</button>
            </div>
            <div className="modal-content">
              <div className="edit-user-form-group">
                <div className="form-row">
                  <label className="input-label">Name:</label>
                  <input
                    className="input-modern"
                    type="text"
                    value={editUserName}
                    onChange={e => setEditUserName(e.target.value)}
                    placeholder="User name"
                  />
                </div>
                <div className="form-row">
                  <label className="input-label">Email:</label>
                  <input
                    className="input-modern"
                    type="email"
                    value={editUserEmail}
                    onChange={e => setEditUserEmail(e.target.value)}
                    placeholder="Email"
                  />
                </div>
                <div className="form-row">
                  <label className="input-label">Password:</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      className="input-modern"
                      type={showEditUserPassword ? 'text' : 'password'}
                      value={editUserPassword}
                      onChange={e => setEditUserPassword(e.target.value)}
                      placeholder="Leave blank to keep unchanged"
                      autoComplete="new-password"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditUserPassword(v => !v)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1em', color: '#7c4dff', padding: 0 }}
                      tabIndex={0}
                      aria-label={showEditUserPassword ? 'Hide password' : 'Show password'}
                    >
                      {showEditUserPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div className="form-row">
                  <label className="input-label">Role:</label>
                  <select
                    className="input-modern"
                    value={editUserRole}
                    onChange={e => setEditUserRole(e.target.value)}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-actions" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
              <button onClick={() => setEditModalOpen(false)} className="modal-action-btn cancel">Cancel</button>
              <button
                className="modal-action-btn"
                onClick={async () => {
                  try {
                    await axios.patch(`/api/admin/users/${editingUser.id}`, {
                      name: editUserName,
                      role: editUserRole,
                      email: editUserEmail,
                      ...(editUserPassword ? { password: editUserPassword } : {})
                    });
                    setEditModalOpen(false);
                    setSnackbar({ isVisible: true, message: 'User updated successfully.', type: 'success' });
                    refetchUsers && refetchUsers();
                  } catch (error) {
                    setSnackbar({ isVisible: true, message: error?.response?.data?.error || 'Failed to update user.', type: 'error' });
                  }
                }}
              >Save</button>
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
                  
                  {paginate(channelsData.channels, channelsPage, PAGE_SIZE).map((channel) => (
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
              )}
              {channelsData.channels.length > PAGE_SIZE && (
                <Pagination
                  page={channelsPage}
                  setPage={setChannelsPage}
                  total={channelsData.channels.length}
                  pageSize={PAGE_SIZE}
                  ariaLabel="Channels pagination"
                />
              )}

              {channelsData?.dms?.length > 0 && (
                <div className="dms-list">
                  <h3>Direct Messages</h3>
                  <div className="dms-grid">
                    {paginate(channelsData.dms, dmsPage, PAGE_SIZE).map((dm) => (
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
              {channelsData.dms.length > PAGE_SIZE && (
                <Pagination
                  page={dmsPage}
                  setPage={setDmsPage}
                  total={channelsData.dms.length}
                  pageSize={PAGE_SIZE}
                  ariaLabel="DMs pagination"
                />
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={async () => {
          setConfirmModal(modal => ({ ...modal, loading: true }));
          await confirmModal.onConfirm();
          setConfirmModal({ open: false, title: '', message: '', onConfirm: null, loading: false });
        }}
        onCancel={() => setConfirmModal({ open: false, title: '', message: '', onConfirm: null, loading: false })}
        loading={confirmModal.loading}
      />
    </>
  );
}

export default AdminControlDashboard; 