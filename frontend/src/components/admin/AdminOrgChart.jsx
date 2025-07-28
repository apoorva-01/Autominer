import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import Select from 'react-select';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useNavigate } from 'react-router-dom';
import '@xyflow/react/dist/style.css';
import SimpleSnackbar from '../common/SimpleSnackbar';
import Skeleton from '../common/Skeleton';
import { 
  Save, Database, Building, ChevronRight, 
  UserPlus, UserCheck, AlertCircle, Users,
  ExternalLink, Settings, MoreHorizontal, X
} from 'lucide-react';
import { useDepartments } from '../../contexts/DepartmentsContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import WorkspaceSelector from '../common/WorkspaceSelector';
import { useQuery } from 'react-query';

// Modern style additions
import './OrganizationView.css';

function AdminOrgChart() {
  const { user, isAdmin, isAuthenticated, loading: authLoading } = useAuth();
  const { selectedWorkspace, workspaces, loading: workspaceLoading, error: workspaceError, refreshWorkspaces } = useWorkspace();
  const [people, setPeople] = useState([]);
  const { departments, loading: departmentsLoading, fetchDepartments } = useDepartments();
  const [teamAssignments, setTeamAssignments] = useState({});
  const [managerAssignments, setManagerAssignments] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const navigate = useNavigate();
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [unassignedPeople, setUnassignedPeople] = useState([]);
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const [peopleWithConversations, setPeopleWithConversations] = useState(new Set());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  

  
  // Try to refresh workspaces if there was an error
  useEffect(() => {
    if (workspaceError && isAuthenticated && !authLoading) {
      refreshWorkspaces();
    }
  }, [workspaceError, isAuthenticated, authLoading, refreshWorkspaces]);
  
  // Fetch departments for the selected workspace
  useEffect(() => {
    if (!selectedWorkspace || !isAuthenticated) {
      return;
    }
    
    try {
      fetchDepartments(selectedWorkspace.slackTeamId);
    } catch (err) {
      console.error("Error fetching departments:", err);
      setSnackbar({
        isVisible: true,
        message: 'Failed to load departments. Please try again.',
        type: 'error'
      });
    }
  }, [selectedWorkspace, fetchDepartments, isAuthenticated]);

  // Fetch people and org chart data when selected workspace changes
  useEffect(() => {
    if (!selectedWorkspace || !isAuthenticated) return;
    setLoading(true);
    setError(null);
    
    const slackTeamId = selectedWorkspace.slackTeamId;
    if (slackTeamId) {
      axios.get(`/api/analysis/people?slackTeamId=${slackTeamId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      .then(res => {
        setPeople(res.data.people || []);
        setPeopleWithConversations(new Set(res.data.peopleWithConversations || []));
        
        return axios.get(`/api/analysis/orgchart?slackTeamId=${slackTeamId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
      })
      .then(resp => {
        setTeamAssignments(resp.data.assignments || {});
        setManagerAssignments(resp.data.managerAssignments || {});
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading data:', err);
        setError(err);
        setTeamAssignments({});
        setManagerAssignments({});
        setLoading(false);
        
        if (err.response?.status === 401) {
          setSnackbar({
            isVisible: true,
            message: 'Authentication error. Please try logging in again.',
            type: 'error'
          });
        } else {
          setSnackbar({
            isVisible: true,
            message: 'Failed to load organization data. Please try again.',
            type: 'error'
          });
        }
      });
    }
  }, [selectedWorkspace, isAuthenticated]);

  // No longer filtering by active status
  const filteredPeople = useMemo(() => {
    return people;
  }, [people]);

  // Memoize columns to prevent infinite update loop
  const columns = useMemo(() => {
    const cols = {};
    departments.forEach(dept => { cols[dept.id] = []; });
    let unassigned = [];
    
    filteredPeople.forEach(person => {
      const deptId = teamAssignments[person.id];
      if (deptId && departments.some(d => d.id === deptId)) {
        cols[deptId].push(person);
      } else if (unassignedPeople.includes(person.id)) {
        unassigned.push(person);
      }
    });
    cols['Unassigned'] = unassigned;
    return cols;
  }, [departments, filteredPeople, teamAssignments, unassignedPeople]);

  // react-select options
  const personOptions = useMemo(() => {
    return filteredPeople
      .filter(p => {
        // Check if person is already assigned to a department
        const assigned = teamAssignments[p.id] && departments.some(d => d.id === teamAssignments[p.id]);
        // Check if person is already in the unassigned list
        const alreadyUnassigned = unassignedPeople.includes(p.id);
        // Only show available people (not assigned and not unassigned)
        return !assigned && !alreadyUnassigned;
      })
      .map(p => ({ 
        value: p.id, 
        label: p.name || 'Unknown User',
        data: p  // Keep the full person data for rendering custom options
      }));
  }, [filteredPeople, teamAssignments, departments, unassignedPeople]);

  // Add helper to capitalize each word in a name
  function capitalizeName(name) {
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }

  // Restore the getInitials function since we'll need it
  function getInitials(name) {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  }
  


  // Build React Flow nodes and edges for the selected department
  useEffect(() => {
    // Only show org chart for the first department for now (can be improved)
    const allNodes = [];
    const allEdges = [];
    departments.forEach(dept => {
      const deptPeople = columns[dept.id] || [];
      deptPeople.forEach((person, idx) => {
        allNodes.push({
          id: person.id,
          type: 'default',
          data: { label: person.name },
          position: { x: 250 + idx * 120, y: 100 + idx * 60 }
        });
        const managerId = managerAssignments[person.id];
        // Create edge for any manager assignment, regardless of department
        const manager = people.find(p => p.id === managerId);
        if (manager) {
          allEdges.push({ id: `${manager.id}->${person.id}`, source: manager.id, target: person.id });
        }
      });
    });
    setNodes(allNodes);
    setEdges(allEdges);
  }, [departments, columns, managerAssignments, people]);

  // Drag and drop handlers
  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { draggableId, destination, source } = result;
    
    // Add visual feedback animation after drop
    const draggableElement = document.getElementById(`person-card-${draggableId}`);
    if (draggableElement) {
      draggableElement.classList.add('drop-success');
      setTimeout(() => {
        if (draggableElement) {
          draggableElement.classList.remove('drop-success');
        }
      }, 800);
    }
    
    if (destination.droppableId === 'Unassigned') {
      setTeamAssignments(prev => {
        const newAssignments = { ...prev };
        delete newAssignments[draggableId];
        return newAssignments;
      });
      setManagerAssignments(prev => {
        const newManagers = { ...prev };
        delete newManagers[draggableId];
        return newManagers;
      });
      setUnassignedPeople(prev => prev.includes(draggableId) ? prev : [...prev, draggableId]);
      
      // Show feedback for unassigned action
      setSnackbar({
        isVisible: true,
        message: 'Team member moved to Unassigned',
        type: 'info'
      });
    } else {
      setTeamAssignments(prev => ({ ...prev, [draggableId]: destination.droppableId }));
      setUnassignedPeople(prev => prev.filter(id => id !== draggableId));
      
      // Show feedback for assignment action
      const dept = departments.find(d => d.id === destination.droppableId);
      if (dept) {
        setSnackbar({
          isVisible: true,
          message: `Team member assigned to ${dept.name}`,
          type: 'success'
        });
      }
    }
    // Only clear the selected person if they were just assigned (moved out of Unassigned)
    const floatingPerson = selectedPerson ? people.find(p => p.id === selectedPerson.value) : null;
    if (floatingPerson && draggableId === floatingPerson.id && source.droppableId === 'Unassigned' && destination.droppableId !== 'Unassigned') {
      setSelectedPerson(null);
    }
  };

  // Manager assignment dropdown handler
  const handleManagerChange = (userId, managerId) => {
    setManagerAssignments(prev => ({ ...prev, [userId]: managerId }));
  };

  // Add People to Unassigned handler
  const handleAddPeople = () => {
    if (selectedPeople.length === 0) return;
    
    const newIds = selectedPeople.filter(opt => !unassignedPeople.includes(opt.value)).map(opt => opt.value);
    
    setUnassignedPeople(prev => [...prev, ...newIds]);
    setSelectedPeople([]);
    
    // Show feedback
    setSnackbar({
      isVisible: true,
      message: `${newIds.length} team member${newIds.length !== 1 ? 's' : ''} added to Unassigned`,
      type: 'success'
    });
  };

  const handleSave = () => {
    if (!selectedWorkspace) {
      setSnackbar({ isVisible: true, message: 'Please select a workspace first.', type: 'error' });
      return;
    }
    
    setSaving(true);
    setError(null);
    const slackTeamId = selectedWorkspace.slackTeamId;
    
    axios.post('/api/analysis/orgchart', {
      slackTeamId,
      assignments: teamAssignments,
      managerAssignments
    }, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    }).then(() => {
      setSnackbar({ isVisible: true, message: 'Org chart saved successfully!', type: 'success' });
      setSaving(false);
    }).catch(err => {
      console.error('Error saving org chart:', err);
      setSnackbar({ 
        isVisible: true, 
        message: err.response?.status === 401 
          ? 'Authentication error. Please try logging in again.'
          : 'Failed to save org chart. Please try again.',
        type: 'error'
      });
      setError(err);
      setSaving(false);
    });
  };

  const closeSnackbar = () => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  // Skeleton loading screen
  if (authLoading || workspaceLoading) {
    return (
      <div className="org-chart-page">
        <div className="org-chart-container loading-container">
          {/* Dashboard header skeleton */}
          <div className="dashboard-header">
            <div className="header-title">
              <Skeleton width="240px" height="32px" shape="rounded" />
              <Skeleton width="360px" height="18px" style={{ marginTop: '8px' }} shape="rounded" />
            </div>
            <div className="header-actions">
              <Skeleton width="180px" height="38px" shape="rounded" />
              <Skeleton width="140px" height="38px" style={{ marginLeft: '12px' }} shape="rounded" />
            </div>
          </div>
          
          {/* Controls skeleton */}
          <div className="org-controls" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
              <Skeleton width="260px" height="38px" shape="rounded" />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Skeleton width="120px" height="38px" shape="rounded" />
              <Skeleton width="120px" height="38px" shape="rounded" />
            </div>
          </div>
          
          {/* Add Team Members skeleton */}
          <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
              <Skeleton width="180px" height="24px" shape="rounded" />
            </div>
            <Skeleton width="100%" height="42px" shape="rounded" />
          </div>
          
          {/* Departments skeleton */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {/* Unassigned column skeleton */}
            <div className="card" style={{ flex: '1 0 300px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
                <Skeleton width="120px" height="24px" shape="rounded" />
                <Skeleton width="30px" height="24px" shape="rounded" style={{ marginLeft: '8px' }} />
              </div>
              <div>
                {[...Array(3)].map((_, j) => (
                  <div key={j} style={{ marginBottom: '12px', display: 'flex', alignItems: 'center' }}>
                    <Skeleton width="40px" height="40px" shape="circle" style={{ marginRight: '12px' }} />
                    <div style={{ flex: 1 }}>
                      <Skeleton width="80%" height="18px" shape="rounded" style={{ marginBottom: '4px' }} />
                      <Skeleton width="40%" height="14px" shape="rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Department columns skeleton */}
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card" style={{ flex: '1 0 300px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
                  <Skeleton width="140px" height="24px" shape="rounded" />
                  <Skeleton width="30px" height="24px" shape="rounded" style={{ marginLeft: '8px' }} />
                </div>
                <div>
                  {[...Array(4)].map((_, j) => (
                    <div key={j} style={{ marginBottom: '12px', display: 'flex', alignItems: 'center' }}>
                      <Skeleton width="40px" height="40px" shape="circle" style={{ marginRight: '12px' }} />
                      <div style={{ flex: 1 }}>
                        <Skeleton width="80%" height="18px" shape="rounded" style={{ marginBottom: '4px' }} />
                        <Skeleton width="40%" height="14px" shape="rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Authentication error
  if (!isAuthenticated) {
    return (
      <div className="org-chart-page">
        <div className="auth-error-card">
          <AlertCircle size={32} />
          <h2>Authentication Required</h2>
          <p>Please log in to view this page</p>
          <button onClick={() => navigate('/login')} className="btn btn-primary">
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // Admin access check
  if (!isAdmin) {
    return (
      <div className="org-chart-page">
        <div className="auth-error-card">
          <AlertCircle size={32} />
          <h2>Admin Access Required</h2>
          <p>You need administrator privileges to view this page</p>
        </div>
      </div>
    );
  }

  // Workspace error
  if (workspaceError) {
    return (
      <div className="org-chart-page">
        <div className="error-card">
          <AlertCircle size={32} />
          <h2>Error Loading Workspaces</h2>
          <p>{workspaceError.message || 'Failed to load workspace data'}</p>
          <button onClick={refreshWorkspaces} className="btn btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="org-chart-page">
        <div className="org-chart-container loading-container">
          {/* Dashboard header skeleton */}
          <div className="dashboard-header">
            <div className="header-title">
              <Skeleton width="240px" height="32px" shape="rounded" />
              <Skeleton width="360px" height="18px" style={{ marginTop: '8px' }} shape="rounded" />
            </div>
            <div className="header-actions">
              <Skeleton width="180px" height="38px" shape="rounded" />
              <Skeleton width="140px" height="38px" style={{ marginLeft: '12px' }} shape="rounded" />
            </div>
          </div>
          
          {/* Controls skeleton */}
          <div className="org-controls" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
              <Skeleton width="260px" height="38px" shape="rounded" />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Skeleton width="120px" height="38px" shape="rounded" />
              <Skeleton width="120px" height="38px" shape="rounded" />
            </div>
          </div>
          
          {/* Add Team Members skeleton */}
          <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
              <Skeleton width="180px" height="24px" shape="rounded" />
            </div>
            <Skeleton width="100%" height="42px" shape="rounded" />
          </div>
          
          {/* Departments skeleton */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {/* Unassigned column skeleton */}
            <div className="card" style={{ flex: '1 0 300px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
                <Skeleton width="120px" height="24px" shape="rounded" />
                <Skeleton width="30px" height="24px" shape="rounded" style={{ marginLeft: '8px' }} />
              </div>
              <div>
                {[...Array(3)].map((_, j) => (
                  <div key={j} style={{ marginBottom: '12px', display: 'flex', alignItems: 'center' }}>
                    <Skeleton width="40px" height="40px" shape="circle" style={{ marginRight: '12px' }} />
                    <div style={{ flex: 1 }}>
                      <Skeleton width="80%" height="18px" shape="rounded" style={{ marginBottom: '4px' }} />
                      <Skeleton width="40%" height="14px" shape="rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Department columns skeleton */}
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card" style={{ flex: '1 0 300px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <Skeleton width="24px" height="24px" shape="circle" style={{ marginRight: '8px' }} />
                  <Skeleton width="140px" height="24px" shape="rounded" />
                  <Skeleton width="30px" height="24px" shape="rounded" style={{ marginLeft: '8px' }} />
                </div>
                <div>
                  {[...Array(4)].map((_, j) => (
                    <div key={j} style={{ marginBottom: '12px', display: 'flex', alignItems: 'center' }}>
                      <Skeleton width="40px" height="40px" shape="circle" style={{ marginRight: '12px' }} />
                      <div style={{ flex: 1 }}>
                        <Skeleton width="80%" height="18px" shape="rounded" style={{ marginBottom: '4px' }} />
                        <Skeleton width="40%" height="14px" shape="rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // No departments screen
  if (departments.length === 0) {
    return (
      <div className="org-chart-page">
        <div className="empty-state-card modern-empty-state">
          <div className="empty-state-header">
          
            <h2>Organization Structure</h2>
            <p className="empty-state-description">
              Set up your organization's departments to visualize and manage your team structure effectively.
            </p>
          </div>

          <div className="workspace-info-section">
            <label className="workspace-label">Current Workspace:</label>
            <div className="workspace-selector-container enhanced">
              <WorkspaceSelector />
            </div>
          </div>
          
          <div className="empty-state-illustration">
            <div className="org-chart-illustration">
              <div className="illustration-node main-node">
                <Building size={24} />
              </div>
              <div className="illustration-branches">
                <div className="illustration-branch"></div>
                <div className="illustration-branch"></div>
                <div className="illustration-branch"></div>
              </div>
              <div className="illustration-nodes">
                <div className="illustration-node sub-node"><Users size={16} /></div>
                <div className="illustration-node sub-node"><Users size={16} /></div>
                <div className="illustration-node sub-node"><Users size={16} /></div>
              </div>
            </div>
          </div>

       
          
          <div className="action-container">
            <p className="action-hint">Create departments to start building your organizational chart</p>
            <button 
              onClick={() => navigate('/settings', { state: { section: 'departments' } })} 
              className="btn btn-primary create-department-btn"
            >
              <Building size={18} />
              <span>Create Department</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="org-chart-page">
      <div className="org-chart-container">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>
              <Users size={26} className="header-icon" />
              Organization Chart
            </h1>
          </div>
          
          <div className="header-actions">
            <div className="workspace-selector-wrapper">
              <div className="workspace-label">Workspace:</div>
              <WorkspaceSelector className="enhanced-workspace-selector" />
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !selectedWorkspace}
              className={`btn btn-primary enhanced-save-button ${saving ? 'saving' : ''}`}
            >
              {saving ? (
                <>
                  <span className="loader"></span>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={18} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
        

        
        {/* Remove org controls since there's no filter anymore */}
        
        <div className="people-management-container">
          <div className="team-members-section">
            {/* <div className="section-header">
              <h2>Add Team Members</h2>
            </div> */}
            <div className="person-select-wrapper">
              <Select
                options={personOptions}
                value={selectedPeople}
                onChange={setSelectedPeople}
                isClearable
                isSearchable
                isMulti
                placeholder="Search for team members..."
                className="person-select enhanced-select"
                classNamePrefix="person-select"
                formatOptionLabel={option => (
                  <div className="select-option-container">
                    
                    <div className="select-option-details">
                      <div className="select-option-name">{option.label}</div>
                      {option.data?.title && (
                        <div className="select-option-title">{option.data.title}</div>
                      )}
                    </div>
                  </div>
                )}
              />
              <button 
                onClick={handleAddPeople} 
                disabled={selectedPeople.length === 0} 
                className={`btn btn-primary add-members-btn ${selectedPeople.length === 0 ? 'btn-disabled' : ''}`}
              >
                <UserPlus size={18} />
                <span>Add to Unassigned</span>
              </button>
            </div>
          </div>
        </div>
          
        {/* Drag and drop area */}
        <DragDropContext onDragEnd={onDragEnd}>
          <div className={`departments-container`}>
            {/* Unassigned column */}
            {(departments.length > 0 && columns['Unassigned'].length > 0) && (
              <Droppable droppableId="Unassigned" key="Unassigned">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`department-column unassigned-column ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                    style={{ 
                      width: '300px',
                      minWidth: '300px',
                      maxWidth: '350px',
                      flexGrow: '1',
                      border: '2px dotted #71717a',
                      borderRadius: '8px'
                    }}
                  >
                    <div className="column-header unassigned-header">
                      <UserCheck size={20} className="column-icon" />
                      <h3>Unassigned</h3>
                      <div className="count-badge">{columns['Unassigned'].length}</div>
                    </div>
                    
                    <div className={`column-content`}>
                      {columns['Unassigned'].length === 0 ? (
                        <div className="empty-column-message">
                          <UserCheck size={24} className="empty-icon" />
                          <p>No unassigned members</p>
                        </div>
                      ) : (
                        columns['Unassigned'].map((person, idx) => (
                          <Draggable draggableId={String(person.id)} index={idx} key={String(person.id)}>
                            {(provided, snapshot) => (
                              <div
                                id={`person-card-${person.id}`}
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`person-card ${snapshot.isDragging ? 'dragging' : ''}`}
                                aria-label={`Unassigned person: ${person.name}`}
                                tabIndex={0}
                              >
                               
                                <div className="person-info">
                                  <span className="person-name">{capitalizeName(person.name)}</span>
                                  {person.title && (
                                    <span className="person-title">{person.title}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                    <div className="drag-instruction">
                      <span>Drag to assign to departments</span>
                    </div>
                  </div>
                )}
              </Droppable>
            )}
            
            {/* Department columns */}
            {departments.map((dept, deptIdx) => (
              <Droppable droppableId={dept.id} key={dept.id}>
                {(provided, snapshot) => {
                  // Enhanced pastel color palette for departments
                  const deptColors = [
                    { bg: 'hsl(215, 100%, 97%)', accent: 'hsl(215, 80%, 65%)' },
                    { bg: 'hsl(260, 100%, 97%)', accent: 'hsl(260, 80%, 65%)' },
                    { bg: 'hsl(145, 100%, 97%)', accent: 'hsl(145, 80%, 65%)' },
                    { bg: 'hsl(330, 100%, 97%)', accent: 'hsl(330, 80%, 65%)' },
                    { bg: 'hsl(190, 100%, 97%)', accent: 'hsl(190, 80%, 65%)' },
                    { bg: 'hsl(40, 100%, 97%)', accent: 'hsl(40, 80%, 65%)' },
                    { bg: 'hsl(80, 100%, 97%)', accent: 'hsl(80, 80%, 65%)' },
                    { bg: 'hsl(170, 100%, 97%)', accent: 'hsl(170, 80%, 65%)' },
                    { bg: 'hsl(300, 100%, 97%)', accent: 'hsl(300, 80%, 65%)' },
                  ];
                  
                  const deptColor = deptColors[deptIdx % deptColors.length];
                  
                  return (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`department-column ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                      style={{ 
                        '--dept-bg': deptColor.bg,
                        '--dept-accent': deptColor.accent,
                        width: '300px',
                        minWidth: '300px',
                        flexGrow: '1',
                        border: `2px dotted ${deptColor.accent}`,
                        borderRadius: '8px'
                      }}>
                      <div className="column-header">
                        <span 
                          className="dept-color-dot"
                          style={{ background: deptColor.accent }}
                        />
                        <h3>{dept.name}</h3>
                        {/* <div className="count-badge">{columns[dept.id].length}</div> */}
                        <button 
                          className="icon-button view-dept-button"
                          onClick={() => navigate(`/orgchart/department/${encodeURIComponent(dept.name)}`, { 
                            state: { connectionId: selectedWorkspace?.id } 
                          })}
                          title={`View ${dept.name} department details`}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      
                      <div className={`column-content`}>
                        {columns[dept.id].length === 0 ? (
                          <div className="empty-column-message">
                            <Users size={24} className="empty-icon" />
                            <p>No members assigned</p>
                            <span className="empty-instructions">Drag people here</span>
                          </div>
                        ) : (
                          columns[dept.id].map((person, idx) => (
                            <Draggable draggableId={String(person.id)} index={idx} key={String(person.id)}>
                              {(provided, snapshot) => (
                                <div
                                  id={`person-card-${person.id}`}
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`person-card ${snapshot.isDragging ? 'dragging' : ''}`}
                                  aria-label={`Department member: ${person.name}`}
                                  tabIndex={0}
                                >
                                 
                                  <div className="person-info">
                                    <span className="person-name">{capitalizeName(person.name)}</span>
                                    {person.title && (
                                      <span className="person-title">{person.title}</span>
                                    )}
                                    {peopleWithConversations.has((typeof person === 'string' ? person : person.id)) && (
                                      <span 
                                        className="data-indicator" 
                                        title="Has Slack data"
                                      >
                                        <Database size={14} />
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))
                        )}
                        {provided.placeholder}
                      </div>
                    </div>
                  );
                }}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
        
        {/* Mobile menu toggle */}
        <button 
          className={`mobile-menu-toggle ${isMobileMenuOpen ? 'open' : ''}`}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle mobile menu"
        >
          <Settings size={24} />
        </button>
        
        {/* Mobile action menu */}
        <div className={`mobile-action-menu ${isMobileMenuOpen ? 'open' : ''}`}>
          <div className="mobile-menu-header">
            <h3>Organization Chart</h3>
            <button 
              className="close-mobile-menu"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <X size={24} />
            </button>
          </div>
          <div className="mobile-menu-content">
            <button 
              className="mobile-menu-button save-button"
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={20} />
              <span>{saving ? "Saving..." : "Save Changes"}</span>
            </button>
          </div>
        </div>
        
        <SimpleSnackbar
          message={snackbar.message}
          type={snackbar.type}
          isVisible={snackbar.isVisible}
          onClose={closeSnackbar}
        />
      </div>
    </div>
  );
}

export default AdminOrgChart; 