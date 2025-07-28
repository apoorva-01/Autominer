import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { RefreshCw, CheckCircle, XCircle, Clock, Shield, Search, Filter, ChevronDown, Zap, BarChart4, Layers } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import SimpleSnackbar from '../common/SimpleSnackbar';
import Skeleton from '../common/Skeleton';
import './Analysis.css'; // Reuse Analysis styling
import './Automations.css'; // Add specific styling for Automations

function Automations() {
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'pending', 'approved', 'rejected', 'implemented'
  const [sortBy, setSortBy] = useState('date'); // 'date', 'confidence', 'priority'
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // Check if user is admin
  if (!isAdmin) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <Shield size={48} />
          <h2>Admin Access Required</h2>
          <p>Automation management is only available to administrators.</p>
          <p>Please contact your administrator for access.</p>
        </div>
      </div>
    );
  }

  // Fetch all workspaces
  const { data: workspaces } = useQuery('slack-workspaces', async () => {
    const response = await axios.get('/api/slack/workspaces');
    return response.data.workspaces;
  });

  // Fetch automation tasks with filters
  const { data: automations, isLoading, isFetching, refetch } = useQuery(
    ['automations', statusFilter, selectedTeam, sortBy, searchTerm],
    async () => {
      const params = {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        slackTeamId: selectedTeam || undefined,
        sortBy: sortBy,
        search: searchTerm || undefined
      };
      
      const response = await axios.get('/api/analysis/automations', { params });
      return response.data;
    },
    {
      refetchOnWindowFocus: false,
      staleTime: 30000, // 30 seconds
    }
  );

  const updateTaskStatusMutation = useMutation(
    ({ taskId, status }) => axios.patch(`/api/analysis/tasks/${taskId}/status`, { status }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('automations');
        setSnackbar({
          isVisible: true,
          message: 'Task status updated successfully',
          type: 'success'
        });
      },
      onError: (error) => {
        setSnackbar({
          isVisible: true,
          message: error?.response?.data?.error || 'Failed to update task status',
          type: 'error'
        });
      }
    }
  );

  const handleStatusChange = (taskId, status) => {
    updateTaskStatusMutation.mutate({ taskId, status });
  };

  const closeSnackbar = () => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  // Filter tasks based on search term
  const filteredTasks = useMemo(() => {
    if (!automations?.tasks) return [];
    
    return automations.tasks.filter(task => {
      if (!searchTerm) return true;
      
      const searchLower = searchTerm.toLowerCase();
      return (
        (task.title || '').toLowerCase().includes(searchLower) ||
        (task.taskName || '').toLowerCase().includes(searchLower) ||
        (task.taskDescription || '').toLowerCase().includes(searchLower) ||
        (task.suggestedAutomationApproach || '').toLowerCase().includes(searchLower)
      );
    });
  }, [automations?.tasks, searchTerm]);

  // Calculate stats
  const implementedCount = filteredTasks.filter(t => t.status === 'implemented').length;
  const approvedCount = filteredTasks.filter(t => t.status === 'approved').length;
  const pendingCount = filteredTasks.filter(t => t.status === 'pending').length;
  const rejectedCount = filteredTasks.filter(t => t.status === 'rejected').length;

  return (
    <div className="analysis-container modern-bg">
      <div className="page-header">
        <div className="page-header-content">
          <h1><Zap size={24} /> Automation Opportunities</h1>
          <p>Manage and implement automation opportunities discovered during analysis.</p>
        </div>
      </div>
      
      <div className="card">
        <div className="filter-controls">
          <div className="search-filter">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search automations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-group">
            <label htmlFor="workspace-filter">Workspace:</label>
            <select
              id="workspace-filter"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="modern-select"
            >
              <option value="">All Workspaces</option>
              {workspaces?.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="status-filter">Status:</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="modern-select"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="implemented">Implemented</option>
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="sort-by">Sort By:</label>
            <select
              id="sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="modern-select"
            >
              <option value="date">Date (Newest)</option>
              <option value="confidence">Confidence</option>
              <option value="priority">Priority</option>
              <option value="timeSaved">Time Saved</option>
            </select>
          </div>
          
          <button 
            onClick={() => refetch()} 
            className={`refresh-button modern-btn ${isFetching ? 'is-loading' : ''}`} 
            title="Refresh automations"
            disabled={isFetching}
          >
            <RefreshCw size={16} className={isFetching ? 'spinning' : ''} />
            {isFetching ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        
        <div className="summary-section">
          <h2>Automation Summary</h2>
          <p>
            Showing {filteredTasks.length} automation {filteredTasks.length === 1 ? 'opportunity' : 'opportunities'}
            {statusFilter !== 'all' ? ` with status: ${statusFilter}` : ''}
            {selectedTeam ? ' for selected workspace' : ''}
            {searchTerm ? ` matching: "${searchTerm}"` : ''}
          </p>
        </div>
        
        <div className="automation-stats">
          <div className="stat-card implemented">
            <div className="stat-icon">
              <CheckCircle size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{implementedCount}</div>
              <div className="stat-label">Implemented</div>
            </div>
          </div>
          <div className="stat-card approved">
            <div className="stat-icon">
              <CheckCircle size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{approvedCount}</div>
              <div className="stat-label">Approved</div>
            </div>
          </div>
          <div className="stat-card pending">
            <div className="stat-icon">
              <Clock size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{pendingCount}</div>
              <div className="stat-label">Pending</div>
            </div>
          </div>
          <div className="stat-card rejected">
            <div className="stat-icon">
              <XCircle size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{rejectedCount}</div>
              <div className="stat-label">Rejected</div>
            </div>
          </div>
          <div className="stat-card total">
            <div className="stat-icon">
              <Layers size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{filteredTasks.length}</div>
              <div className="stat-label">Total</div>
            </div>
          </div>
        </div>
        
        {isLoading ? (
          <div className="skeleton-container">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} width="100%" height="180px" className="skeleton-task" shape="rounded" />
            ))}
          </div>
        ) : filteredTasks.length > 0 ? (
          <div className="tasks-grid">
            {filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onStatusChange={handleStatusChange}
                isUpdating={updateTaskStatusMutation.isLoading}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <BarChart4 size={48} />
            <p>No automation opportunities found matching your criteria.</p>
            <p>Try changing your filters or running a new analysis.</p>
          </div>
        )}
      </div>
      
      <SimpleSnackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={closeSnackbar}
      />
    </div>
  );
}

function TaskCard({ task, onStatusChange, isUpdating }) {
  const statusOptions = [
    { value: 'pending', label: 'Pending', icon: Clock },
    { value: 'approved', label: 'Approved', icon: CheckCircle },
    { value: 'rejected', label: 'Rejected', icon: XCircle },
    { value: 'implemented', label: 'Implemented', icon: CheckCircle },
  ];

  const currentStatus = statusOptions.find(s => s.value === task.status);
  const StatusIcon = currentStatus?.icon || Clock;

  return (
    <div className={`task-card ${task.status}`}>
      <div className="task-header">
        <div className="task-status" title={currentStatus?.label}>
          <StatusIcon size={16} className={`status-icon ${task.status}`} />
          <span className={`status-label ${task.status}`}>{currentStatus?.label || task.status}</span>
        </div>
        <div className="task-confidence">
          {Math.round(task.confidence * 100)}% confidence
        </div>
      </div>
      <div className="task-content">
        <h3>{task.title || task.taskName || task.taskDescription}</h3>
        <p>{task.taskDescription}</p>
        <div className="task-meta">
          <span className="chip frequency-badge" title="Frequency">Freq: {task.frequencyScore ?? task.frequency}</span>
          <span className="chip difficulty-badge" title="Ease of Automation">Ease: {task.automationEaseScore ?? task.difficulty}</span>
          <span className="chip roi-badge" title="Priority/ROI">Priority: {task.priorityScore ?? task.estimatedRoi}</span>
          <span className="chip time-saved-badge" title="Estimated Time Saved">Time: {task.estimatedTimeSaved}</span>
        </div>
        <div className="task-steps">
          <strong>Manual Steps:</strong> <span>{task.currentManualSteps}</span>
        </div>
        <div className="task-approach">
          <strong>Suggested Automation:</strong> <span>{task.suggestedAutomationApproach}</span>
        </div>
        <div className="task-rationale">
          <strong>Rationale:</strong> <span>{task.rationale}</span>
        </div>
        {task.suggestedTools && task.suggestedTools.length > 0 && (
          <div className="task-tools">
            <h4>Suggested Tools:</h4>
            <div className="tools-list">
              {task.suggestedTools.map((tool, index) => (
                <span key={index} className="tool-tag chip" title={tool}>{tool}</span>
              ))}
            </div>
          </div>
        )}
        <div className="task-source">
          <p>
            Found in: {task.slackConversation?.channelName || task.source || 'Unknown source'}
            {task.slackConversation?.slackConnection?.slackTeamName && ` (${task.slackConversation?.slackConnection?.slackTeamName})`}
          </p>
          <p className="task-date">
            {new Date(task.createdAt).toLocaleDateString()} {new Date(task.createdAt).toLocaleTimeString()}
          </p>
        </div>
      </div>
      <div className="task-actions">
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
          disabled={isUpdating}
          className="modern-select"
          title="Change task status"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default Automations; 