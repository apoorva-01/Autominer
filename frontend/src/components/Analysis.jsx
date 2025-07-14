import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { Play, RefreshCw, CheckCircle, XCircle, Clock, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function Analysis() {
  const [selectedConnection, setSelectedConnection] = useState('');
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  // Check if user is admin
  if (!isAdmin) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <Shield size={48} />
          <h2>Admin Access Required</h2>
          <p>Analysis features are only available to administrators.</p>
          <p>Please contact your administrator for access.</p>
        </div>
      </div>
    );
  }

  const { data: connections } = useQuery('slack-connections', async () => {
    const response = await axios.get('/api/slack/connections');
    return response.data.connections;
  });

  const { data: results, isLoading: resultsLoading, refetch } = useQuery(
    'analysis-results',
    async () => {
      const response = await axios.get('/api/analysis/results');
      return response.data;
    }
  );

  const runAnalysisMutation = useMutation(
    (data) => axios.post('/api/analysis/run', data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('analysis-results');
        queryClient.invalidateQueries('analysis-summary');
      },
    }
  );

  const updateTaskStatusMutation = useMutation(
    ({ taskId, status }) => axios.patch(`/api/analysis/tasks/${taskId}/status`, { status }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('analysis-results');
      },
    }
  );

  const handleRunAnalysis = () => {
    runAnalysisMutation.mutate({
      connectionId: selectedConnection || undefined,
      dateRange: { from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
  };

  const handleStatusChange = (taskId, status) => {
    updateTaskStatusMutation.mutate({ taskId, status });
  };

  return (
    <div className="analysis-container">
      <div className="analysis-header">
        <h1>AI Analysis</h1>
        <p>Run AI analysis on your Slack conversations to discover automation opportunities</p>
      </div>

      <div className="analysis-controls">
        <div className="control-group">
          <label htmlFor="connection-select">Select Workspace (optional)</label>
          <select
            id="connection-select"
            value={selectedConnection}
            onChange={(e) => setSelectedConnection(e.target.value)}
          >
            <option value="">All Workspaces</option>
            {connections?.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.slackTeamName}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRunAnalysis}
          disabled={runAnalysisMutation.isLoading}
          className="run-analysis-button"
        >
          {runAnalysisMutation.isLoading ? (
            <><RefreshCw size={20} className="spinning" /> Running Analysis...</>
          ) : (
            <><Play size={20} /> Run Analysis</>
          )}
        </button>
      </div>

      {runAnalysisMutation.isSuccess && (
        <div className="success-message">
          <CheckCircle size={16} />
          Analysis completed! Found {runAnalysisMutation.data.data.totalTasksFound} potential automation tasks.
        </div>
      )}

      {runAnalysisMutation.isError && (
        <div className="error-message">
          <XCircle size={16} />
          Analysis failed. Please try again.
        </div>
      )}

      <div className="analysis-results">
        <div className="results-header">
          <h2>Analysis Results</h2>
          <button onClick={() => refetch()} className="refresh-button">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {resultsLoading ? (
          <div className="loading">Loading results...</div>
        ) : results && results.tasks.length > 0 ? (
          <div className="tasks-grid">
            {results.tasks.map((task) => (
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
            <Clock size={48} />
            <p>No analysis results yet. Run your first analysis to discover automation opportunities.</p>
          </div>
        )}
      </div>
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
    <div className="task-card">
      <div className="task-header">
        <div className="task-status">
          <StatusIcon size={16} className={`status-icon ${task.status}`} />
          <span className={`status-label ${task.status}`}>
            {currentStatus?.label || task.status}
          </span>
        </div>
        <div className="task-confidence">
          {Math.round(task.confidence * 100)}% confidence
        </div>
      </div>

      <div className="task-content">
        <h3>{task.taskDescription}</h3>
        <div className="task-meta">
          <span className={`frequency-badge ${task.frequency}`}>
            {task.frequency}
          </span>
          <span className={`difficulty-badge ${task.difficulty}`}>
            {task.difficulty} difficulty
          </span>
          <span className={`roi-badge ${task.estimatedRoi}`}>
            {task.estimatedRoi} ROI
          </span>
        </div>

        <div className="task-tools">
          <h4>Suggested Tools:</h4>
          <div className="tools-list">
            {task.suggestedTools.map((tool, index) => (
              <span key={index} className="tool-tag">
                {tool}
              </span>
            ))}
          </div>
        </div>

        <div className="task-source">
          <p>
            Found in: {task.slackConversation.channelName || 'DM'} 
            ({task.slackConversation.slackConnection.slackTeamName})
          </p>
        </div>
      </div>

      <div className="task-actions">
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
          disabled={isUpdating}
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

export default Analysis; 