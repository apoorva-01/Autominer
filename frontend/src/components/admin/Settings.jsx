import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import './AdminControlDashboard.css';
import SimpleSnackbar from '../common/SimpleSnackbar';
import { Pencil, Trash2, Plus, X, Save, Settings as SettingsIcon, Users, Tag, Building2 } from 'lucide-react';
import Skeleton from '../common/Skeleton';
import { useDepartments } from '../../contexts/DepartmentsContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import WorkspaceSelector from '../common/WorkspaceSelector';

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

function Settings() {
  const { isAdmin } = useAuth();
  const { selectedWorkspace } = useWorkspace();
  
  // Role management state
  const [section, setSection] = useState('roles'); // 'roles' or 'departments'
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [editingRole, setEditingRole] = useState(null); // old name
  const [editingRoleName, setEditingRoleName] = useState(''); // editable name
  const [editingDesc, setEditingDesc] = useState('');
  const [roleActionLoading, setRoleActionLoading] = useState(false);
  
  // Department management state
  const { departments, loading: departmentsLoading, fetchDepartments, createDepartment, updateDepartment, deleteDepartment } = useDepartments();
  const [departmentError, setDepartmentError] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newDepartmentDesc, setNewDepartmentDesc] = useState('');
  const [editingDepartment, setEditingDepartment] = useState(null); // id
  const [editingDepartmentName, setEditingDepartmentName] = useState(''); // name
  const [editingDepartmentDesc, setEditingDepartmentDesc] = useState(''); // desc
  const [departmentActionLoading, setDepartmentActionLoading] = useState(false);
  
  // Modal and notification state
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, loading: false });
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'error' });

  // Fetch roles
  const fetchRoles = async () => {
    if (!selectedWorkspace) return;
    setRolesLoading(true);
    setRoleError('');
    try {
      const res = await axios.get('/api/analysis/roles', { params: { slackTeamId: selectedWorkspace.slackTeamId } });
      if (Array.isArray(res.data.roles)) {
        setRoles(res.data.roles);
      } else if (Array.isArray(res.data)) {
        setRoles(res.data);
      } else {
        setRoles([]);
      }
    } catch (err) {
      setRoleError('Failed to fetch roles.');
      setSnackbar({ isVisible: true, message: 'Failed to fetch roles.', type: 'error' });
    }
    setRolesLoading(false);
  };
  
  useEffect(() => {
    if (section === 'roles' && selectedWorkspace) fetchRoles();
  }, [section, selectedWorkspace]);

  // Fetch departments
  useEffect(() => {
    if (section === 'departments' && selectedWorkspace) {
      fetchDepartments(selectedWorkspace.slackTeamId);
    }
  }, [section, selectedWorkspace, fetchDepartments]);

  // Add role
  const handleAddRole = async () => {
    if (!newRole || !selectedWorkspace) {
      setRoleError('Please enter a role name and select a workspace.');
      setSnackbar({ isVisible: true, message: 'Please enter a role name and select a workspace.', type: 'error' });
      return;
    }
    setRoleActionLoading(true);
    setRoleError('');
    try {
      await axios.post('/api/analysis/roles', { role: newRole, description: newRoleDesc, slackTeamId: selectedWorkspace.slackTeamId });
      setNewRole('');
      setNewRoleDesc('');
      fetchRoles();
      setSnackbar({ isVisible: true, message: 'Role added successfully!', type: 'success' });
    } catch (err) {
      setRoleError('Failed to add role.');
      setSnackbar({ isVisible: true, message: 'Failed to add role.', type: 'error' });
    }
    setRoleActionLoading(false);
  };
  
  // Delete role
  const handleDeleteRole = async (role) => {
    setConfirmModal({
      open: true,
      title: 'Delete Role',
      message: `Are you sure you want to delete role '${role}'? This action cannot be undone.`,
      onConfirm: async () => {
        if (!selectedWorkspace) return;
        setRoleActionLoading(true);
        setRoleError('');
        try {
          await axios.delete('/api/analysis/roles', { data: { role, slackTeamId: selectedWorkspace.slackTeamId } });
          fetchRoles();
          setSnackbar({ isVisible: true, message: 'Role deleted successfully!', type: 'success' });
        } catch (err) {
          setRoleError('Failed to delete role.');
          setSnackbar({ isVisible: true, message: 'Failed to delete role.', type: 'error' });
        }
        setRoleActionLoading(false);
      },
      loading: false
    });
  };
  
  // Edit role description
  const handleEditRole = async (oldRoleName) => {
    if (!editingRoleName) return;
    setRoleActionLoading(true);
    setRoleError('');
    try {
      await axios.post('/api/analysis/roles', {
        role: editingRoleName,
        description: editingDesc, // allow empty string
        slackTeamId: selectedWorkspace.slackTeamId,
        oldRole: editingRole // send old name for backend to update
      });
      setEditingRole(null);
      setEditingRoleName('');
      setEditingDesc('');
      fetchRoles();
      setSnackbar({ isVisible: true, message: 'Role updated successfully!', type: 'success' });
    } catch (err) {
      setRoleError('Failed to update role.');
      setSnackbar({ isVisible: true, message: 'Failed to update role.', type: 'error' });
    }
    setRoleActionLoading(false);
  };

  // Add department
  const handleAddDepartment = async () => {
    if (!newDepartment || !selectedWorkspace) {
      setDepartmentError('Please enter a department name and select a workspace.');
      setSnackbar({ isVisible: true, message: 'Please enter a department name and select a workspace.', type: 'error' });
      return;
    }
    setDepartmentActionLoading(true);
    setDepartmentError('');
    try {
      // The API doesn't directly use the description as a parameter, so add it separately
      await axios.post('/api/analysis/departments', {
        name: newDepartment,
        description: newDepartmentDesc,
        slackTeamId: selectedWorkspace.slackTeamId
      });
      
      // Refresh departments list after creating
      fetchDepartments(selectedWorkspace.slackTeamId);
      
      setNewDepartment('');
      setNewDepartmentDesc('');
      setSnackbar({ isVisible: true, message: 'Department added successfully!', type: 'success' });
    } catch (err) {
      setDepartmentError('Failed to add department.');
      setSnackbar({ isVisible: true, message: 'Failed to add department.', type: 'error' });
    }
    setDepartmentActionLoading(false);
  };
  
  // Delete department
  const handleDeleteDepartment = async (id) => {
    setConfirmModal({
      open: true,
      title: 'Delete Department',
      message: 'Are you sure you want to delete this department? This action cannot be undone.',
      onConfirm: async () => {
        if (!selectedWorkspace) return;
        setDepartmentActionLoading(true);
        setDepartmentError('');
        try {
          await deleteDepartment(id, selectedWorkspace.slackTeamId);
          setSnackbar({ isVisible: true, message: 'Department deleted successfully!', type: 'success' });
        } catch (err) {
          setDepartmentError('Failed to delete department.');
          setSnackbar({ isVisible: true, message: 'Failed to delete department.', type: 'error' });
        }
        setDepartmentActionLoading(false);
      },
      loading: false
    });
  };
  
  // Edit department
  const handleEditDepartment = async (id) => {
    if (!editingDepartment || !selectedWorkspace) return;
    setDepartmentActionLoading(true);
    setDepartmentError('');
    try {
      await updateDepartment(id, { name: editingDepartmentName, description: editingDepartmentDesc }, selectedWorkspace.slackTeamId);
      setEditingDepartment(null);
      setEditingDepartmentName('');
      setEditingDepartmentDesc('');
      setSnackbar({ isVisible: true, message: 'Department updated successfully!', type: 'success' });
    } catch (err) {
      setDepartmentError('Failed to update department.');
      setSnackbar({ isVisible: true, message: 'Failed to update department.', type: 'error' });
    }
    setDepartmentActionLoading(false);
  };

  if (!isAdmin) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <SettingsIcon size={48} />
          <h2>Access Denied</h2>
          <p>You don't have permission to access settings.</p>
        </div>
      </div>
    );
  }

  // Skeleton for loading roles or departments
  const showSkeleton = (rolesLoading && section === 'roles' && selectedWorkspace) || (departmentsLoading && section === 'departments' && selectedWorkspace);

  return (
    <>
    <div className="admin-dashboard">
      {/* Header with Tabs and Workspace Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div className="admin-tabs">
          <button
            className={`admin-tab-btn${section === 'roles' ? ' active' : ''}`}
            onClick={() => setSection('roles')}
          >
            Role Management
          </button>
          <button
            className={`admin-tab-btn${section === 'departments' ? ' active' : ''}`}
            onClick={() => setSection('departments')}
          >
           Department Management
          </button>
        </div>
        
        <div className="workspace-selector-container" style={{
          minWidth: '280px',
          // background: 'white',
          // padding: '12px 16px',
          // borderRadius: '8px',
          // boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          // border: '1px solid #e5e7eb',
          transition: 'all 0.2s ease',
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            marginBottom: '8px',
            color: 'rgba(124, 58, 237, 0.9)'
          }}>
            <label className="form-label" style={{ 
              margin: 0, 
              fontWeight: '500',
              fontSize: '0.875rem',
              color: 'rgba(124, 58, 237, 0.9)'
            }}>
              Select Workspace
            </label>
          </div>
          <div style={{
            position: 'relative',
            width: '100%'
          }}>
            <WorkspaceSelector />
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="card" style={{ padding: '1.5rem' }}>
        {showSkeleton ? (
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <Skeleton width="180px" height="2em" style={{ marginBottom: 24 }} shape="rounded" />
            <Skeleton width="100%" height="48px" style={{ marginBottom: 16 }} shape="rounded" />
            <Skeleton width="100%" height="48px" style={{ marginBottom: 16 }} shape="rounded" />
            <Skeleton width="60%" height="32px" style={{ marginBottom: 16 }} shape="rounded" />
            <Skeleton width="100%" height="32px" style={{ marginBottom: 8 }} shape="rounded" />
            <Skeleton width="100%" height="32px" style={{ marginBottom: 8 }} shape="rounded" />
          </div>
        ) : (
          <>
            {/* Role Management Section */}
            {section === 'roles' && (
              <>
                <div className="subsection-header" style={{ marginBottom: '1.5rem' }}>
                  <Tag className="subsection-icon" size={30} color="rgba(124, 58, 237, 0.9)" />
                  <h3>Role Management</h3>
                </div>
                {!selectedWorkspace && (
                  <div className="empty-state">
                    <p>Please select a workspace to manage roles.</p>
                  </div>
                )}
                {selectedWorkspace && (
                  <>
                    {/* Add Role Form */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                        <div style={{ flex: 2 }}>
                          <input
                            type="text"
                            placeholder="Enter role name"
                            value={newRole}
                            onChange={e => setNewRole(e.target.value)}
                            className="form-input"
                            disabled={roleActionLoading}
                            aria-label="Role name"
                          />
                        </div>
                        <div style={{ flex: 3 }}>
                          <input
                            type="text"
                            placeholder="Brief description of the role"
                            value={newRoleDesc}
                            onChange={e => setNewRoleDesc(e.target.value)}
                            className="form-input"
                            disabled={roleActionLoading}
                            aria-label="Role description"
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                          <button
                            onClick={handleAddRole}
                            disabled={roleActionLoading || !newRole}
                            className="submit-button"
                            style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                          >
                            {roleActionLoading ? (
                              <span className="button-spinner"></span>
                            ) : (
                              <Plus size={20} />
                            )}
                            <span>Add Role</span>
                          </button>
                        </div>
                      </div>
                      {roleError && (
                        <div className="error-message" style={{ padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.5rem', color: '#ef4444', marginBottom: '1rem' }}>
                          {roleError}
                        </div>
                      )}
                    </div>
                    
                    {/* Roles List */}
                    {roles.length === 0 ? (
                      <div className="empty-state">No roles found. Add your first role above.</div>
                    ) : (
                      <div className="table-responsive">
                        <table className="jobs-table zebra">
                          <thead>
                            <tr>
                              <th>Role Name</th>
                              <th>Description</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {roles.map(role => (
                              <tr key={typeof role === 'string' ? role : role.name} className="table-row-hover">
                                {editingRole === (typeof role === 'string' ? role : role.name) ? (
                                  <>
                                    <td>
                                      <input
                                        type="text"
                                        value={editingRoleName}
                                        onChange={e => setEditingRoleName(e.target.value)}
                                        className="form-input"
                                        disabled={roleActionLoading}
                                        aria-label="Edit role name"
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="text"
                                        value={editingDesc}
                                        onChange={e => setEditingDesc(e.target.value)}
                                        className="form-input"
                                        disabled={roleActionLoading}
                                        aria-label="Edit role description"
                                      />
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                        <button
                                          onClick={() => handleEditRole(typeof role === 'string' ? role : role.name)}
                                          disabled={roleActionLoading || !editingRoleName}
                                          className="view-details-btn"
                                          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                        >
                                          <Save size={16} /> Save
                                        </button>
                                        <button
                                          onClick={() => { setEditingRole(null); setEditingRoleName(''); setEditingDesc(''); }}
                                          className="cancel-button"
                                          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                        >
                                          <X size={16} /> Cancel
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td>{typeof role === 'string' ? role : role.name}</td>
                                    <td>{role.description || (typeof role === 'string' ? '' : '')}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                        <button
                                          onClick={() => { setEditingRole(typeof role === 'string' ? role : role.name); setEditingRoleName(typeof role === 'string' ? role : role.name); setEditingDesc(role.description || ''); }}
                                          className="view-details-btn"
                                          title="Edit"
                                          aria-label="Edit role"
                                        >
                                          <Pencil size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteRole(typeof role === 'string' ? role : role.name)}
                                          disabled={roleActionLoading}
                                          className="delete-job-btn"
                                          title="Delete"
                                          aria-label="Delete role"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            
            {/* Department Management Section */}
            {section === 'departments' && (
              <>
                <div className="subsection-header" style={{ marginBottom: '1.5rem' }}>
                  <Users className="subsection-icon" size={30} color="rgba(124, 58, 237, 0.9)" />
                  <h3>Department Management</h3>
                </div>
                {!selectedWorkspace && (
                  <div className="empty-state">
                    <p>Please select a workspace to manage departments.</p>
                  </div>
                )}
                {selectedWorkspace && (
                  <>
                    {/* Add Department Form */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                        <div style={{ flex: 2 }}>
                          <input
                            type="text"
                            placeholder="Enter department name"
                            value={newDepartment}
                            onChange={e => setNewDepartment(e.target.value)}
                            className="form-input"
                            disabled={departmentActionLoading}
                            aria-label="Department name"
                          />
                        </div>
                        <div style={{ flex: 3 }}>
                          <input
                            type="text"
                            placeholder="Brief description of the department"
                            value={newDepartmentDesc}
                            onChange={e => setNewDepartmentDesc(e.target.value)}
                            className="form-input"
                            disabled={departmentActionLoading}
                            aria-label="Department description"
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                          <button
                            onClick={handleAddDepartment}
                            disabled={departmentActionLoading || !newDepartment}
                            className="submit-button"
                            style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                          >
                            {departmentActionLoading ? (
                              <span className="button-spinner"></span>
                            ) : (
                              <Plus size={20} />
                            )}
                            <span>Add Department</span>
                          </button>
                        </div>
                      </div>
                      {departmentError && (
                        <div className="error-message" style={{ padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.5rem', color: '#ef4444', marginBottom: '1rem' }}>
                          {departmentError}
                        </div>
                      )}
                    </div>
                    
                    {/* Departments List */}
                    {departments.length === 0 ? (
                      <div className="empty-state">No departments found. Add your first department above.</div>
                    ) : (
                      <div className="table-responsive">
                        <table className="jobs-table zebra">
                          <thead>
                            <tr>
                              <th>Department Name</th>
                              <th>Description</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {departments.map(dept => (
                              <tr key={dept.id} className="table-row-hover">
                                {editingDepartment === dept.id ? (
                                  <>
                                    <td>
                                      <input
                                        type="text"
                                        value={editingDepartmentName}
                                        onChange={e => setEditingDepartmentName(e.target.value)}
                                        className="form-input"
                                        disabled={departmentActionLoading}
                                        aria-label="Edit department name"
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="text"
                                        value={editingDepartmentDesc}
                                        onChange={e => setEditingDepartmentDesc(e.target.value)}
                                        className="form-input"
                                        disabled={departmentActionLoading}
                                        aria-label="Edit department description"
                                      />
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                        <button
                                          onClick={() => handleEditDepartment(dept.id)}
                                          disabled={departmentActionLoading || !editingDepartmentName}
                                          className="view-details-btn"
                                          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                        >
                                          <Save size={16} /> Save
                                        </button>
                                        <button
                                          onClick={() => { setEditingDepartment(null); setEditingDepartmentName(''); setEditingDepartmentDesc(''); }}
                                          className="cancel-button"
                                          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                        >
                                          <X size={16} /> Cancel
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td>{dept.name}</td>
                                    <td>{dept.description}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                        <button
                                          onClick={() => { 
                                            setEditingDepartment(dept.id); 
                                            setEditingDepartmentName(dept.name); 
                                            setEditingDepartmentDesc(dept.description || ''); 
                                          }}
                                          className="view-details-btn"
                                          title="Edit"
                                          aria-label="Edit department"
                                        >
                                          <Pencil size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteDepartment(dept.id)}
                                          disabled={departmentActionLoading}
                                          className="delete-job-btn"
                                          title="Delete"
                                          aria-label="Delete department"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      

    </div>

          {/* Confirm Modal and Snackbar */}
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
      <SimpleSnackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={() => setSnackbar(prev => ({ ...prev, isVisible: false }))}
        duration={5000}
      />
</>
  );
}

export default Settings; 