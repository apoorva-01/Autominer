import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { useDepartments } from '../../contexts/DepartmentsContext';
import { Building, ChevronDown, ChevronRight, Users, AlertCircle, Loader, User, Network } from 'lucide-react';
import SimpleSnackbar from '../common/SimpleSnackbar';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import WorkspaceSelector from '../common/WorkspaceSelector';
import { useNavigate } from 'react-router-dom';
import './OrganizationView.css';

// Node components for the flow chart
const DepartmentNode = React.memo(({ data }) => (
  <div style={{
    background: '#f0f4ff',
    border: '2px solid #4f46e5',
    padding: '16px',
    borderRadius: '8px',
    width: '220px',
    textAlign: 'center',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
  }}>
    <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '8px' }}>{data.label}</div>
    {data.manager && (
      <div style={{ fontSize: '14px', color: '#4f46e5' }}>
        Manager: {data.manager}
      </div>
    )}
    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
      {data.count} members
    </div>
  </div>
));

// Memoized MemberCard component to prevent unnecessary re-renders
const MemberCard = React.memo(({ person, isManager, getInitials }) => (
  <div className="member-card">
    <div 
      className="member-avatar"
      style={{ 
        backgroundColor: isManager ? '#4f46e5' : '#64748b'
      }}
    >
      {getInitials(person.name)}
    </div>
    <div className="member-info">
      <div className="member-name">
        {person.name}
        {isManager && (
          <span className="manager-badge">Manager</span>
        )}
      </div>
      <div className="member-role">
        {person.role || 'Member'}
      </div>
    </div>
  </div>
));

// Helper function to get initials from name - moved outside component as it doesn't use any component state
const getInitials = (name) => {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

function OrganizationView() {
  const { isAdmin, isAuthenticated, loading: authLoading } = useAuth();
  const { selectedWorkspace, loading: workspaceLoading, error: workspaceError, refreshWorkspaces } = useWorkspace();
  const [viewMode, setViewMode] = useState('tree'); // 'tree' or 'chart'
  const [expandedDepts, setExpandedDepts] = useState({});
  const [departmentPeople, setDepartmentPeople] = useState({}); // { deptId: [people] }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'info' });
  const { departments, departmentManagers, fetchDepartments, loading: departmentsLoading } = useDepartments();
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const navigate = useNavigate();
  
  // Close snackbar handler
  const closeSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  }, []);
  
  // Fetch people for a department
  const fetchDepartmentPeople = useCallback(async (deptId) => {
    if (!selectedWorkspace || !isAuthenticated) return;
    
    try {
      const response = await axios.get(`/api/analysis/department-people`, {
        params: {
          department: deptId,
          slackTeamId: selectedWorkspace.slackTeamId
        },
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      setDepartmentPeople(prev => ({
        ...prev,
        [deptId]: response.data.people || []
      }));
    } catch (error) {
      console.error(`Failed to fetch people for department ${deptId}:`, error);
      setError(error);
      
      if (error.response?.status === 401) {
        setSnackbar({
          isVisible: true,
          message: 'Authentication error. Please try logging in again.',
          type: 'error'
        });
      }
    }
  }, [selectedWorkspace, isAuthenticated]);
  
  // Function to toggle department expansion
  const toggleDepartment = useCallback((deptId) => {
    setExpandedDepts(prev => {
      const newState = { ...prev, [deptId]: !prev[deptId] };
      return newState;
    });
  }, []);
  
  // Batch fetch department people for all expanded departments
  const batchFetchDepartmentPeople = useCallback(async () => {
    if (!selectedWorkspace || !isAuthenticated || !departments.length) return;
    
    const expandedDepartments = Object.entries(expandedDepts)
      .filter(([_, isExpanded]) => isExpanded)
      .map(([deptId]) => deptId);
    
    // Skip if no departments are expanded or all expanded departments already have data
    if (expandedDepartments.length === 0 || 
        expandedDepartments.every(deptId => departmentPeople[deptId]?.length > 0)) {
      return;
    }
    
    // Get departments that need to be fetched
    const departmentsToFetch = expandedDepartments.filter(
      deptId => !departmentPeople[deptId] || departmentPeople[deptId].length === 0
    );
    
    if (departmentsToFetch.length === 0) return;
    
    // Fetch in parallel
    try {
      const requests = departmentsToFetch.map(deptId => 
        axios.get(`/api/analysis/department-people`, {
          params: {
            department: deptId,
            slackTeamId: selectedWorkspace.slackTeamId
          },
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        })
      );
      
      const responses = await Promise.all(requests);
      
      // Update state once with all results
      setDepartmentPeople(prev => {
        const newState = { ...prev };
        responses.forEach((response, index) => {
          const deptId = departmentsToFetch[index];
          newState[deptId] = response.data.people || [];
        });
        return newState;
      });
    } catch (error) {
      console.error(`Failed to batch fetch department people:`, error);
      setError(error);
      
      if (error.response?.status === 401) {
        setSnackbar({
          isVisible: true,
          message: 'Authentication error. Please try logging in again.',
          type: 'error'
        });
      }
    }
  }, [selectedWorkspace, isAuthenticated, departments, expandedDepts, departmentPeople]);
  
  // Try to refresh workspaces if there was an error
  useEffect(() => {
    if (workspaceError && isAuthenticated && !authLoading) {
      refreshWorkspaces();
    }
  }, [workspaceError, isAuthenticated, authLoading, refreshWorkspaces]);
  
  // Fetch departments when workspace changes
  useEffect(() => {
    let isMounted = true;
    
    if (selectedWorkspace && isAuthenticated) {
      setLoading(true);
      setError(null);
      try {
        fetchDepartments(selectedWorkspace.slackTeamId)
          .then(() => {
            if (isMounted) {
              setLoading(false);
            }
          })
          .catch((err) => {
            if (isMounted) {
              console.error("Error fetching departments:", err);
              setError(err);
              setLoading(false);
              setSnackbar({
                isVisible: true,
                message: 'Failed to load departments. Please try again.',
                type: 'error'
              });
            }
          });
      } catch (err) {
        if (isMounted) {
          console.error("Error fetching departments:", err);
          setError(err);
          setLoading(false);
          setSnackbar({
            isVisible: true,
            message: 'Failed to load departments. Please try again.',
            type: 'error'
          });
        }
      }
    } else {
      setLoading(false);
    }
    
    return () => {
      isMounted = false;
    };
  }, [selectedWorkspace, fetchDepartments, isAuthenticated]);
  
  // Effect to trigger batch fetch when expanded departments change
  useEffect(() => {
    let isMounted = true;
    
    if (isMounted) {
      batchFetchDepartmentPeople();
    }
    
    return () => {
      isMounted = false;
    };
  }, [expandedDepts, batchFetchDepartmentPeople]);
  
  // Build flow chart nodes and edges
  const flowChartData = useMemo(() => {
    if (viewMode !== 'chart' || !departments.length) return { nodes: [], edges: [] };
    
    const newNodes = [];
    const newEdges = [];
    
    // Prepare nodes for departments
    const deptNodes = departments.map((dept, index) => {
      const managerId = departmentManagers[dept.id];
      let managerName = '';
      
      // Find manager name if exists
      if (managerId && departmentPeople[dept.id]) {
        const manager = departmentPeople[dept.id]?.find(p => p.id === managerId);
        if (manager) {
          managerName = manager.name;
        }
      }
      
      return {
        id: dept.id,
        position: { x: index * 300, y: 100 },
        type: 'departmentNode',
        data: {
          label: dept.name,
          manager: managerName,
          count: departmentPeople[dept.id]?.length || 0,
          managerId
        }
      };
    });
    
    newNodes.push(...deptNodes);
    
    // Create connections between managers and departments
    const managerDepartments = {};
    Object.entries(departmentManagers).forEach(([deptId, managerId]) => {
      if (!managerId) return;
      
      if (!managerDepartments[managerId]) {
        managerDepartments[managerId] = [];
      }
      
      managerDepartments[managerId].push(deptId);
    });
    
    // Add edges for managers with multiple departments
    Object.entries(managerDepartments).forEach(([managerId, deptIds]) => {
      if (deptIds.length <= 1) return; // Skip managers with only one department
      
      // Create virtual manager node
      const managerNodeId = `manager-${managerId}`;
      let managerName = 'Manager';
      
      // Try to find manager name
      for (const deptId of deptIds) {
        if (departmentPeople[deptId]) {
          const manager = departmentPeople[deptId]?.find(p => p.id === managerId);
          if (manager) {
            managerName = manager.name;
            break;
          }
        }
      }
      
      newNodes.push({
        id: managerNodeId,
        position: { 
          x: deptIds.reduce((sum, deptId) => {
            const deptNode = deptNodes.find(n => n.id === deptId);
            return sum + (deptNode ? deptNode.position.x : 0);
          }, 0) / deptIds.length,
          y: 0
        },
        data: { label: managerName }
      });
      
      // Connect manager to departments
      deptIds.forEach(deptId => {
        newEdges.push({
          id: `${managerNodeId}-${deptId}`,
          source: managerNodeId,
          target: deptId
        });
      });
    });
    
    return { nodes: newNodes, edges: newEdges };
  }, [departments, departmentManagers, departmentPeople, viewMode]);
  
  // Update nodes and edges when flowChartData changes
  useEffect(() => {
    if (viewMode === 'chart') {
      setNodes(flowChartData.nodes);
      setEdges(flowChartData.edges);
    }
  }, [flowChartData, viewMode]);
  
  // Memoize tree view component to prevent unnecessary re-renders
  const TreeView = useMemo(() => {
    if (!departments) return null;
    
    if (viewMode !== 'tree') return null;
    
    return (
      <div className="department-tree">
        {departments.length === 0 ? (
          <div className="empty-departments">
            <Building size={48} color="#94a3b8" />
            <p>No departments found for this workspace.</p>
            <button 
              onClick={() => navigate('/settings')}
              className="primary-button"
            >
              Create Departments
            </button>
          </div>
        ) : (
          departments.map(dept => {
            const isExpanded = expandedDepts[dept.id] || false;
            const people = departmentPeople[dept.id] || [];
            const managerId = departmentManagers[dept.id];
            let manager = null;
            
            if (managerId) {
              manager = people.find(p => p.id === managerId);
            }
            
            return (
              <div key={dept.id} className="dept-tree-item">
                <div 
                  className="dept-header" 
                  onClick={() => toggleDepartment(dept.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={20} color="#4f46e5" />
                  ) : (
                    <ChevronRight size={20} color="#4f46e5" />
                  )}
                  <Building size={18} color="#666" />
                  <span className="dept-name">{dept.name}</span>
                  {manager && (
                    <span className="dept-manager">
                      <User size={14} /> {manager.name}
                    </span>
                  )}
                  <span className="dept-count">
                    {people.length} members
                  </span>
                </div>
                
                {isExpanded && (
                  <div className="dept-members">
                    {people.length === 0 ? (
                      <div style={{ gridColumn: '1 / -1', padding: '20px', textAlign: 'center', color: '#64748b' }}>
                        No members assigned to this department
                      </div>
                    ) : (
                      people.map(person => {
                        const isManager = person.id === managerId;
                        return (
                          <MemberCard 
                            key={person.id}
                            person={person}
                            isManager={isManager}
                            getInitials={getInitials}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }, [viewMode, departments, expandedDepts, departmentPeople, departmentManagers, toggleDepartment, navigate]);
  
  // Memoize chart view component
  const ChartView = useMemo(() => {
    if (!departments) return null;
    
    if (viewMode !== 'chart') return null;
    
    return (
      <div className="organization-chart">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ departmentNode: DepartmentNode }}
          fitView
          nodesDraggable={false}
          elementsSelectable={false}
        >
          <Background color="#f0f0f0" gap={16} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    );
  }, [viewMode, nodes, edges, departments]);
  
  // Handle authentication and loading states
  if (authLoading || workspaceLoading) {
    return (
      <div className="org-view-container">
        <div className="loading-state">
          <Loader size={32} className="spinning" />
          <p>Loading organization data...</p>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return (
      <div className="org-view-container">
        <div className="auth-error-message">
          <AlertCircle size={32} color="#ef4444" />
          <h2>Authentication Required</h2>
          <p>Please log in to view this page</p>
          <button onClick={() => navigate('/login')} className="primary-button">
            Go to Login
          </button>
        </div>
      </div>
    );
  }
  
  if (!isAdmin) {
    return (
      <div className="org-view-container">
        <div className="auth-error-message">
          <AlertCircle size={32} color="#ef4444" />
          <h2>Admin Access Required</h2>
          <p>You need admin privileges to view the organization structure.</p>
          <button onClick={() => navigate('/')} className="primary-button">
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }
  
  if (workspaceError) {
    return (
      <div className="org-view-container">
        <div className="workspace-error-message">
          <AlertCircle size={32} color="#ef4444" />
          <h2>Error Loading Workspaces</h2>
          <p>{workspaceError.message || 'Failed to load workspace data'}</p>
          <button onClick={refreshWorkspaces} className="primary-button">
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  const isLoading = loading || departmentsLoading;
  
  if (isLoading) {
    return (
      <div className="org-view-container">
        <div className="loading-state">
          <Loader size={32} className="spinning" />
          <p>Loading organization data...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="org-view-container">
      {/* <div className="org-page-header">
        <div className="org-page-header-content">
          <h1>Organization Structure</h1>
          <p>Visualize your team's organization, departments, and reporting lines.</p>
        </div>
      </div> */}
      
      <div className="org-header">
        <h1 className="org-title">
        Organization Structure

        </h1>
        
        <div className="workspace-selector">
          <WorkspaceSelector />
        </div>
      </div>
      
      <div className="org-view-tabs">
        <button 
          className={`org-view-tab ${viewMode === 'tree' ? 'active' : ''}`} 
          onClick={() => setViewMode('tree')}
        >
          <Users size={18} />
          Tree View
        </button>
        <button 
          className={`org-view-tab ${viewMode === 'chart' ? 'active' : ''}`}
          onClick={() => setViewMode('chart')}
        >
          <Network size={18} />
          Chart View
        </button>
      </div>
      
      {selectedWorkspace && (
        <>
          {viewMode === 'tree' && TreeView}
          {viewMode === 'chart' && ChartView}
        </>
      )}
      
      <SimpleSnackbar
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={closeSnackbar}
      />
    </div>
  );
}

export default React.memo(OrganizationView); 