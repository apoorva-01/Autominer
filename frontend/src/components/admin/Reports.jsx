import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { Plus, FileText, Download, Trash2, Calendar, Shield, BarChart3, ListFilter, Clock, Info, HelpCircle, AlertCircle, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Skeleton from '../common/Skeleton';
import './Reports.css';

// Confirmation Modal
const ConfirmModal = memo(function ConfirmModal({ open, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', loading }) {
  if (!open) return null;
  
  // Memoize event handlers to avoid creating new functions on every render
  const stopPropagation = useCallback((e) => {
    e.stopPropagation();
  }, []);
  
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={stopPropagation}>
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <div className="modal-content">
          <p>{message}</p>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel} className="cancel-button">{cancelText}</button>
          <button onClick={onConfirm} className="submit-button" disabled={loading}>{loading ? 'Processing...' : confirmText}</button>
        </div>
      </div>
    </div>
  );
});

// Tab Component
const ReportTabs = memo(function ReportTabs({ activeTab, setActiveTab }) {
  const tabs = useMemo(() => [
    { id: 'all', label: 'All Reports', icon: <FileText size={16} /> },
    { id: 'weekly', label: 'Weekly', icon: <Clock size={16} /> },
    { id: 'monthly', label: 'Monthly', icon: <Calendar size={16} /> },
    { id: 'quarterly', label: 'Quarterly', icon: <BarChart3 size={16} /> }
  ], []);

  return (
    <div className="report-tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`report-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {activeTab === tab.id && <div className="tab-indicator" />}
        </button>
      ))}
    </div>
  );
});

function Reports() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, loading: false });

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

  // Pass the activeTab to the API to filter server-side for better performance
  const { data: reports, isLoading, error } = useQuery(['reports', activeTab], async () => {
    const response = await axios.get(`/api/reports${activeTab !== 'all' ? `?period=${activeTab}` : ''}`);
    return response.data.reports;
  }, {
    // Add staleTime to prevent unnecessary refetches
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false, // Prevent refetching when window regains focus
    retry: 1, // Retry failed requests once
    onError: (error) => console.error("Reports fetch error:", error)
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

  const handleCreateReport = useCallback((formData) => {
    generateReportMutation.mutate(formData);
  }, [generateReportMutation]);

  const handleDeleteReport = useCallback((reportId) => {
    setConfirmModal({
      open: true,
      title: 'Delete Report',
      message: 'Are you sure you want to delete this report?',
      onConfirm: async () => {
        setConfirmModal(modal => ({ ...modal, loading: true }));
        await deleteReportMutation.mutateAsync(reportId);
      },
      loading: false
    });
  }, [deleteReportMutation]);

  const handleExportReport = useCallback(async (reportId, format = 'json') => {
    try {
      const response = await axios.get(`/api/reports/${reportId}/export?format=${format}`, {
        responseType: format === 'csv' ? 'blob' : 'json'
      });

      // Move file creation off the main thread using setTimeout
      setTimeout(() => {
        if (format === 'csv') {
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `automation-report-${reportId}.csv`);
          document.body.appendChild(link);
          link.click();
          link.remove();
          // Clean up the URL object after download
          setTimeout(() => window.URL.revokeObjectURL(url), 100);
        } else {
          const dataStr = JSON.stringify(response.data, null, 2);
          const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
          const link = document.createElement('a');
          link.href = dataUri;
          link.download = `automation-report-${reportId}.json`;
          link.click();
        }
      }, 0);
    } catch (error) {
      console.error('Export error:', error);
    }
  }, [/* No dependencies needed since axios is stable */]);

  // Memoize report counts to prevent recalculation on each render
  const reportCounts = useMemo(() => {
    if (!reports) return { weekly: 0, monthly: 0, quarterly: 0 };
    
    return reports.reduce((counts, report) => {
      counts[report.period] = (counts[report.period] || 0) + 1;
      return counts;
    }, { weekly: 0, monthly: 0, quarterly: 0 });
  }, [reports]);

  return (
    <div className="reports-container">
      <div className="reports-header">
        <div>
          <h1>Automation Reports</h1>
          <p>Generate and manage automation discovery reports</p>
        </div>
        <div className="reports-actions">
          <button
            onClick={() => setShowCreateModal(true)}
            className="create-report-button"
          >
            <Plus size={20} />
            Generate Report
          </button>
        </div>
      </div>
      
      <div className="reports-summary-cards">
        <div className="summary-card">
          <div className="summary-icon all">
            <FileText size={20} />
          </div>
          <div className="summary-info">
            <span className="summary-count">{reports?.length || 0}</span>
            <span className="summary-label">Total Reports</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon weekly">
            <Clock size={20} />
          </div>
          <div className="summary-info">
            <span className="summary-count">{reportCounts.weekly}</span>
            <span className="summary-label">Weekly</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon monthly">
            <Calendar size={20} />
          </div>
          <div className="summary-info">
            <span className="summary-count">{reportCounts.monthly}</span>
            <span className="summary-label">Monthly</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon quarterly">
            <BarChart3 size={20} />
          </div>
          <div className="summary-info">
            <span className="summary-count">{reportCounts.quarterly}</span>
            <span className="summary-label">Quarterly</span>
          </div>
        </div>
      </div>
      
      {/* Tabs for filtering reports */}
      <ReportTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <div className="reports-filter-bar">
        <div className="filter-info">
          {activeTab !== 'all' ? (
            <span>Showing {activeTab} reports ({reports?.length || 0})</span>
          ) : (
            <span>Showing all reports ({reports?.length || 0})</span>
          )}
        </div>
        <div className="filter-actions">
          <button className="filter-button">
            <ListFilter size={16} />
            Filter
          </button>
        </div>
      </div>

      {/* Skeleton loader for loading state */}
      {isLoading ? (
        <div className="reports-grid">
          {/* Using more descriptive keys instead of array indices */}
          {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((skeletonId) => (
            <div key={skeletonId} className="report-card">
              <Skeleton width="80%" height="2em" style={{ marginBottom: 16 }} shape="rounded" />
              <Skeleton width="60%" height="1.2em" style={{ marginBottom: 8 }} shape="rounded" />
              <Skeleton width="100%" height="32px" style={{ marginBottom: 8 }} shape="rounded" />
              <Skeleton width="100%" height="32px" style={{ marginBottom: 8 }} shape="rounded" />
              <Skeleton width="100%" height="32px" style={{ marginBottom: 8 }} shape="rounded" />
            </div>
          ))}
        </div>
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
          <p>
            {activeTab === 'all'
              ? 'No reports generated yet. Create your first automation report.'
              : `No ${activeTab} reports found. Create a new ${activeTab} report.`}
          </p>
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
          initialPeriod={activeTab !== 'all' ? activeTab : 'weekly'}
        />
      )}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={async () => {
          await confirmModal.onConfirm();
          setConfirmModal({ open: false, title: '', message: '', onConfirm: null, loading: false });
        }}
        onCancel={() => setConfirmModal({ open: false, title: '', message: '', onConfirm: null, loading: false })}
        loading={confirmModal.loading}
      />
    </div>
  );
}

// Memoized ReportCard to prevent unnecessary re-renders
const ReportCard = memo(function ReportCard({ report, onDelete, onExport, isDeleting }) {
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
});

// Memoized CreateReportModal to prevent unnecessary re-renders
const CreateReportModal = memo(function CreateReportModal({ onClose, onSubmit, isLoading, initialPeriod = 'weekly' }) {
  const [formData, setFormData] = useState({
    title: '',
    period: initialPeriod,
    startDate: '',
    endDate: ''
  });
  const [errors, setErrors] = useState({});
  const [activeTooltip, setActiveTooltip] = useState(null);
  // Removed unused state variable showPeriodDropdown
  const [periodChanged, setPeriodChanged] = useState(false);

  // Auto-suggest dates based on period selection - with proper dependencies
  useEffect(() => {
    // Create a memoized function to calculate dates
    const calculateDates = () => {
      const now = new Date();
      let start = new Date();
      let end = new Date();
      
      switch (formData.period) {
        case 'weekly':
          // Start from beginning of previous week
          start.setDate(now.getDate() - now.getDay() - 7);
          end.setDate(start.getDate() + 6);
          break;
        case 'monthly':
          // Start from 1st of previous month
          start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          end = new Date(now.getFullYear(), now.getMonth(), 0);
          break;
        case 'quarterly':
          // Previous quarter
          const quarter = Math.floor(now.getMonth() / 3) - 1;
          const year = quarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
          start = new Date(year, (quarter < 0 ? 9 : quarter * 3), 1);
          end = new Date(year, (quarter < 0 ? 11 : quarter * 3) + 3, 0);
          break;
        default:
          break;
      }
      
      return { start, end };
    };
    
    // Use the calculated dates
    const { start, end } = calculateDates();
    
    // Batch state updates to reduce renders
    setFormData(prev => {
      // Prepare the updates in a single object
      const updates = {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      };
      
      // Only update title if period changed or title is empty
      if (periodChanged || !prev.title.trim()) {
        updates.title = `${formData.period.charAt(0).toUpperCase() + formData.period.slice(1)} Automation Report - ${
          start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        }`;
      }
      
      return { ...prev, ...updates };
    });
    
    if (periodChanged) {
      setPeriodChanged(false);
    }
  }, [formData.period, periodChanged]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    // Simple validation
    const newErrors = {};
    if (!formData.title.trim()) newErrors.title = "Title is required";
    if (!formData.startDate) newErrors.startDate = "Start date is required";
    if (!formData.endDate) newErrors.endDate = "End date is required";
    
    // Check if end date is after start date
    if (formData.startDate && formData.endDate && new Date(formData.startDate) > new Date(formData.endDate)) {
      newErrors.endDate = "End date must be after start date";
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    onSubmit(formData);
  }, [formData, onSubmit]);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    
    if (name === 'period') {
      setPeriodChanged(true);
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when field is edited
    setErrors(prev => ({
      ...prev,
      [name]: undefined
    }));
  }, []);

  // Memoize tooltips to prevent recreation on each render
  const tooltips = useMemo(() => ({
    title: "Give your report a descriptive name to easily identify it later",
    period: "Choose how often this report should be generated",
    dateRange: "Select the time period to analyze for automation opportunities"
  }), []);

  // Get report period presets - memoized
  const datePresets = useMemo(() => {
    const now = new Date();
    
    switch (formData.period) {
      case 'weekly':
        return [
          {
            label: 'Last Week',
            getRange: () => {
              const start = new Date(now);
              start.setDate(now.getDate() - now.getDay() - 7);
              const end = new Date(start);
              end.setDate(start.getDate() + 6);
              return { start, end };
            }
          },
          {
            label: '2 Weeks Ago',
            getRange: () => {
              const start = new Date(now);
              start.setDate(now.getDate() - now.getDay() - 14);
              const end = new Date(start);
              end.setDate(start.getDate() + 6);
              return { start, end };
            }
          },
          {
            label: '4 Weeks Ago',
            getRange: () => {
              const start = new Date(now);
              start.setDate(now.getDate() - now.getDay() - 28);
              const end = new Date(start);
              end.setDate(start.getDate() + 6);
              return { start, end };
            }
          }
        ];
      
      case 'monthly':
        return [
          {
            label: 'Last Month',
            getRange: () => {
              const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              const end = new Date(now.getFullYear(), now.getMonth(), 0);
              return { start, end };
            }
          },
          {
            label: '2 Months Ago',
            getRange: () => {
              const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
              const end = new Date(now.getFullYear(), now.getMonth() - 1, 0);
              return { start, end };
            }
          },
          {
            label: '3 Months Ago',
            getRange: () => {
              const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
              const end = new Date(now.getFullYear(), now.getMonth() - 2, 0);
              return { start, end };
            }
          }
        ];
        
      case 'quarterly':
        return [
          {
            label: 'Last Quarter',
            getRange: () => {
              const quarter = Math.floor(now.getMonth() / 3) - 1;
              const year = quarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
              const start = new Date(year, (quarter < 0 ? 9 : quarter * 3), 1);
              const end = new Date(year, (quarter < 0 ? 11 : quarter * 3) + 3, 0);
              return { start, end };
            }
          },
          {
            label: '2 Quarters Ago',
            getRange: () => {
              const quarter = Math.floor(now.getMonth() / 3) - 2;
              const year = quarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
              const start = new Date(year, (quarter < 0 ? 12 + (quarter * 3) : quarter * 3), 1);
              const end = new Date(year, (quarter < 0 ? 12 + (quarter * 3) : quarter * 3) + 3, 0);
              return { start, end };
            }
          }
        ];
      default:
        return [];
    }
  }, [formData.period]);

  // Apply preset date range
  const applyDatePreset = useCallback((preset) => {
    const { start, end } = preset.getRange();
    
    setFormData(prev => ({
      ...prev,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0]
    }));
  }, [setFormData]);

  // Format date for display - memoized to prevent recreation on each render
  const formatDate = useCallback((dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  }, []);

  // Get period icon - memoized
  const getPeriodIcon = useCallback((period) => {
    switch (period) {
      case 'weekly': return <Clock size={16} />;
      case 'monthly': return <Calendar size={16} />;
      case 'quarterly': return <BarChart3 size={16} />;
      default: return <Clock size={16} />;
    }
  }, []);
  
  // Get date range description - memoized based on date values
  const dateRangeDescription = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return '';
    
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    const daysDiff = Math.round((end - start) / (1000 * 60 * 60 * 24));
    
    if (daysDiff <= 7) return 'Weekly analysis';
    if (daysDiff <= 31) return 'Monthly analysis';
    return 'Quarterly analysis';
  }, [formData.startDate, formData.endDate]);

  // Memoize to prevent recreation on each render
  const stopPropagation = useCallback((e) => {
    e.stopPropagation();
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal create-report-modal" onClick={stopPropagation}>
        <div className="modal-header">
          <h2>
            <FileText size={20} className="modal-header-icon" />
            Generate New Report
          </h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="modal-subheader">
          <p>Create a new report to analyze automation opportunities in your Slack workflows</p>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="title">Report Title</label>
              <div className="tooltip-container">
                <HelpCircle 
                  size={16} 
                  className="help-icon" 
                  onMouseEnter={() => setActiveTooltip('title')}
                  onMouseLeave={() => setActiveTooltip(null)}
                />
                {activeTooltip === 'title' && (
                  <div className="tooltip">{tooltips.title}</div>
                )}
              </div>
            </div>
            <div className="input-container">
              <FileText size={16} className="input-icon" />
              <input
                id="title"
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="Weekly Automation Report"
                className={errors.title ? "input-error" : ""}
              />
            </div>
            {errors.title && (
              <div className="error-message">
                <AlertCircle size={14} />
                {errors.title}
              </div>
            )}
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="period">Report Period</label>
              <div className="tooltip-container">
                <HelpCircle 
                  size={16} 
                  className="help-icon" 
                  onMouseEnter={() => setActiveTooltip('period')}
                  onMouseLeave={() => setActiveTooltip(null)}
                />
                {activeTooltip === 'period' && (
                  <div className="tooltip">{tooltips.period}</div>
                )}
              </div>
            </div>
            <div className="select-container">
              <div className="period-options">
                <label className={`period-option ${formData.period === 'weekly' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="period"
                    value="weekly"
                    checked={formData.period === 'weekly'}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <Clock size={16} />
                  <span>Weekly</span>
                  {formData.period === 'weekly' && (
                    <Check size={14} className="period-check" />
                  )}
                </label>
                
                <label className={`period-option ${formData.period === 'monthly' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="period"
                    value="monthly"
                    checked={formData.period === 'monthly'}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <Calendar size={16} />
                  <span>Monthly</span>
                  {formData.period === 'monthly' && (
                    <Check size={14} className="period-check" />
                  )}
                </label>
                
                <label className={`period-option ${formData.period === 'quarterly' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="period"
                    value="quarterly"
                    checked={formData.period === 'quarterly'}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <BarChart3 size={16} />
                  <span>Quarterly</span>
                  {formData.period === 'quarterly' && (
                    <Check size={14} className="period-check" />
                  )}
                </label>
              </div>
            </div>
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <label>Date Range</label>
              <div className="tooltip-container">
                <HelpCircle 
                  size={16} 
                  className="help-icon" 
                  onMouseEnter={() => setActiveTooltip('dateRange')}
                  onMouseLeave={() => setActiveTooltip(null)}
                />
                {activeTooltip === 'dateRange' && (
                  <div className="tooltip">{tooltips.dateRange}</div>
                )}
              </div>
            </div>
            
            <div className="date-presets">
              {datePresets.map((preset, index) => (
                <button 
                  key={index}
                  type="button"
                  className="date-preset-button"
                  onClick={() => applyDatePreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            
            <div className="date-range-container">
              <div className="date-range-label">
                {getPeriodIcon(formData.period)} 
                <span>{dateRangeDescription}</span>
              </div>
              
              <div className="date-input-group">
                <label htmlFor="startDate">From</label>
                <div className="input-container">
                  <Calendar size={16} className="input-icon" />
                  <input
                    id="startDate"
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    className={errors.startDate ? "input-error" : ""}
                  />
                </div>
                {errors.startDate && (
                  <div className="error-message">
                    <AlertCircle size={14} />
                    {errors.startDate}
                  </div>
                )}
              </div>

              <div className="date-range-separator">
                <span>to</span>
              </div>

              <div className="date-input-group">
                <label htmlFor="endDate">To</label>
                <div className="input-container">
                  <Calendar size={16} className="input-icon" />
                  <input
                    id="endDate"
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                    className={errors.endDate ? "input-error" : ""}
                  />
                </div>
                {errors.endDate && (
                  <div className="error-message">
                    <AlertCircle size={14} />
                    {errors.endDate}
                  </div>
                )}
              </div>
              
              <div className="date-range-preview">
                {formatDate(formData.startDate)} - {formatDate(formData.endDate)}
              </div>
            </div>
          </div>

          <div className="form-info-message">
            <Info size={16} />
            <span>Report generation may take a few minutes depending on the selected time range</span>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="cancel-button">
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="submit-button">
              {isLoading ? (
                <>
                  <div className="spinner"></div>
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <FileText size={16} />
                  <span>Generate Report</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default Reports; 