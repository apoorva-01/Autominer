import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { Plus, FileText, Download, Trash2, Calendar, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function Reports() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  // Check if user is admin
  if (!isAdmin) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <Shield size={48} />
          <h2>Admin Access Required</h2>
          <p>Reports features are only available to administrators.</p>
          <p>Please contact your administrator for access.</p>
        </div>
      </div>
    );
  }

  const { data: reports, isLoading } = useQuery('reports', async () => {
    const response = await axios.get('/api/reports');
    return response.data.reports;
  });

  const generateReportMutation = useMutation(
    (data) => axios.post('/api/reports/generate', data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('reports');
        setShowCreateModal(false);
      },
    }
  );

  const deleteReportMutation = useMutation(
    (reportId) => axios.delete(`/api/reports/${reportId}`),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('reports');
      },
    }
  );

  const handleCreateReport = (formData) => {
    generateReportMutation.mutate(formData);
  };

  const handleDeleteReport = (reportId) => {
    if (window.confirm('Are you sure you want to delete this report?')) {
      deleteReportMutation.mutate(reportId);
    }
  };

  const handleExportReport = async (reportId, format = 'json') => {
    try {
      const response = await axios.get(`/api/reports/${reportId}/export?format=${format}`, {
        responseType: format === 'csv' ? 'blob' : 'json'
      });

      if (format === 'csv') {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `automation-report-${reportId}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        const dataStr = JSON.stringify(response.data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = `automation-report-${reportId}.json`;
        link.click();
      }
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  return (
    <div className="reports-container">
      <div className="reports-header">
        <div>
          <h1>Automation Reports</h1>
          <p>Generate and manage automation discovery reports</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="create-report-button"
        >
          <Plus size={20} />
          Generate Report
        </button>
      </div>

      {isLoading ? (
        <div className="loading">Loading reports...</div>
      ) : reports && reports.length > 0 ? (
        <div className="reports-grid">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onDelete={handleDeleteReport}
              onExport={handleExportReport}
              isDeleting={deleteReportMutation.isLoading}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FileText size={48} />
          <p>No reports generated yet. Create your first automation report.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="secondary-button"
          >
            Generate Report
          </button>
        </div>
      )}

      {showCreateModal && (
        <CreateReportModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateReport}
          isLoading={generateReportMutation.isLoading}
        />
      )}
    </div>
  );
}

function ReportCard({ report, onDelete, onExport, isDeleting }) {
  return (
    <div className="report-card">
      <div className="report-header">
        <div className="report-info">
          <h3>{report.title}</h3>
          <p className="report-period">{report.period} report</p>
          <p className="report-date">
            {new Date(report.startDate).toLocaleDateString()} - {new Date(report.endDate).toLocaleDateString()}
          </p>
        </div>
        <div className="report-stats">
          <span className="task-count">{report._count.tasks} tasks</span>
        </div>
      </div>

      <div className="report-meta">
        <div className="meta-item">
          <Calendar size={16} />
          <span>Created {new Date(report.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="report-actions">
        <button
          onClick={() => onExport(report.id, 'json')}
          className="action-button export"
        >
          <Download size={16} />
          JSON
        </button>
        <button
          onClick={() => onExport(report.id, 'csv')}
          className="action-button export"
        >
          <Download size={16} />
          CSV
        </button>
        <button
          onClick={() => onDelete(report.id)}
          disabled={isDeleting}
          className="action-button delete"
        >
          <Trash2 size={16} />
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateReportModal({ onClose, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    title: '',
    period: 'weekly',
    startDate: '',
    endDate: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Generate New Report</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="title">Report Title</label>
            <input
              id="title"
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="e.g., Weekly Automation Report"
            />
          </div>

          <div className="form-group">
            <label htmlFor="period">Period</label>
            <select
              id="period"
              name="period"
              value={formData.period}
              onChange={handleChange}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="startDate">Start Date</label>
              <input
                id="startDate"
                type="date"
                name="startDate"
                value={formData.startDate}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="endDate">End Date</label>
              <input
                id="endDate"
                type="date"
                name="endDate"
                value={formData.endDate}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="cancel-button">
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="submit-button">
              {isLoading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Reports; 