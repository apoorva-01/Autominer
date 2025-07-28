import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ReactFlow, Background, Controls, Handle, Position, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import SimpleSnackbar from '../common/SimpleSnackbar';
import { useNodesState, useEdgesState } from '@xyflow/react';
import { Save, Building, ChevronRight, Home, RefreshCw, Users, Briefcase, Network, AlertCircle } from 'lucide-react';
import { useDepartments } from '../../contexts/DepartmentsContext';
import dagre from 'dagre';
import './DepartmentDetails.css';

// Helper to capitalize names
function capitalizeName(name) {
  if (!name) return '';
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

// Custom node for people with both source and target handles
const PersonNode = ({ data }) => (
  <div className="person-node">
    <Handle type="target" position={Position.Top} style={{ background: '#4f46e5', width: 10, height: 10, borderRadius: '50%' }} />
    <div>{capitalizeName(data.label)}</div>
    <Handle type="source" position={Position.Bottom} style={{ background: '#4f46e5', width: 10, height: 10, borderRadius: '50%' }} />
  </div>
);

// Custom node for departments
const DepartmentNode = ({ data }) => (
  <div className="department-node" style={{ 
    background: data.bgColor || '#f0f4ff',
    border: `2px solid ${data.borderColor || '#4f46e5'}`
  }}>
    <Handle type="target" position={Position.Top} style={{ background: '#4f46e5', width: 10, height: 10, borderRadius: '50%' }} />
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
      <Building size={18} />
      <span>{data.label}</span>
    </div>
    {data.managerName && (
      <div className="node-manager-name">
        Manager: {capitalizeName(data.managerName)}
      </div>
    )}
    <div className="node-people-count">
      {data.peopleCount || 0} {data.peopleCount === 1 ? 'member' : 'members'}
    </div>
    <Handle type="source" position={Position.Bottom} style={{ background: '#4f46e5', width: 10, height: 10, borderRadius: '50%' }} />
  </div>
);

// Loading component
const LoadingSpinner = ({ message }) => (
  <div className="loading-container">
    <div className="spinner-large" />
    <p>{message || 'Loading...'}</p>
  </div>
);

// Error message component
const ErrorMessage = ({ message, onBackClick }) => (
  <div className="error-message">
    <AlertCircle size={24} style={{ marginBottom: '0.5rem' }} />
    <p>{message}</p>
    {onBackClick && (
      <button 
        className="secondary-button" 
        onClick={onBackClick}
      >
        Back to Organization
      </button>
    )}
  </div>
);

function DepartmentDetails() {
  const navigate = useNavigate();
  const { departmentName, id } = useParams();
  const location = useLocation();
  const connectionId = location.state?.connectionId || '';
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  // Use either departmentName or id parameter depending on which route was used
  const currentDepartmentName = departmentName || id;
  const [departmentDisplayName, setDepartmentDisplayName] = useState('');
  const [people, setPeople] = useState([]);
  const [roles, setRoles] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [managerAssignments, setManagerAssignments] = useState({});
  const [departmentManagers, setDepartmentManagers] = useState({}); // { departmentId: managerId }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loadingError, setLoadingError] = useState('');
  const [loadingStep, setLoadingStep] = useState('Initializing...');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'success' });
  const [invalidEdgeSnackbar, setInvalidEdgeSnackbar] = useState({ isVisible: false, message: '' });
  const [activeView, setActiveView] = useState('department'); // 'department' or 'organization'
  const [allPeople, setAllPeople] = useState([]); // All people across departments
  const [orgNodes, setOrgNodes, onOrgNodesChange] = useNodesState([]);
  const [orgEdges, setOrgEdges, onOrgEdgesChange] = useEdgesState([]);
  const { departments: allDepartments, fetchDepartments } = useDepartments();
  
  // Track if component is mounted to prevent state updates after unmounting
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Function to close snackbar
  const closeSnackbar = () => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  // Function to close invalid edge snackbar
  const closeInvalidEdgeSnackbar = () => {
    setInvalidEdgeSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  // Register custom node types
  const nodeTypes = useMemo(() => ({ 
    person: PersonNode,
    department: DepartmentNode 
  }), []);

  // Fetch departments and resolve departmentId from departmentName
  useEffect(() => {
    if (!connectionId) {
      console.log('DepartmentDetails: Missing connectionId, cannot load');
      setLoadingError('Missing connection ID. Please select a workspace first.');
      return;
    }
    
    setLoadingStep('Loading departments...');
    console.log('DepartmentDetails: Fetching departments with connectionId:', connectionId);
    let isCancelled = false;
    const source = axios.CancelToken.source();
    
    const fetchData = async () => {
      try {
        const deptRes = await axios.get(
          `/api/analysis/departments?connectionId=${encodeURIComponent(connectionId)}`,
          { cancelToken: source.token }
        );
        
        if (isCancelled) return;
        
        const depts = deptRes.data.departments || [];
        console.log('DepartmentDetails: Received departments:', depts);
        setDepartments(depts);
        
        const dept = depts.find(d => d.name === currentDepartmentName);
        if (dept) {
          console.log('DepartmentDetails: Found matching department:', dept);
          setDepartmentId(dept.id);
          setDepartmentDisplayName(dept.name);
        } else {
          console.log('DepartmentDetails: No matching department found for:', currentDepartmentName);
          setDepartmentId('');
          setDepartmentDisplayName(currentDepartmentName);
        }
        
        // Fetch department managers
        const managerRes = await axios.get(
          `/api/analysis/department-managers?connectionId=${encodeURIComponent(connectionId)}`,
          { cancelToken: source.token }
        );
        
        if (isCancelled) return;
        
        console.log('DepartmentDetails: Received department managers:', managerRes.data.managers);
        setDepartmentManagers(managerRes.data.managers || {});
        
        // Load all departments for organization view
        fetchDepartments(connectionId);
      } catch (err) {
        if (!axios.isCancel(err) && isMounted) {
          console.error("Failed to fetch departments/managers:", err);
          setLoadingError(`Failed to fetch departments: ${err.message}`);
          setLoading(false);
        }
      }
    };
    
    fetchData();
    
    return () => {
      isCancelled = true;
      source.cancel('Component unmounted');
    };
  }, [currentDepartmentName, connectionId, fetchDepartments, isMounted]);

  // Fetch all people for the organization view
  useEffect(() => {
    if (!connectionId || departments.length === 0) return;
    
    let isCancelled = false;
    const source = axios.CancelToken.source();
    
    const fetchPeople = async () => {
      try {
        const res = await axios.get(
          `/api/analysis/people?slackTeamId=${encodeURIComponent(departments[0]?.slackTeamId || '')}`,
          { cancelToken: source.token }
        );
        
        if (isCancelled || !isMounted) return;
        
        setAllPeople(res.data.people || []);
      } catch (err) {
        if (!axios.isCancel(err) && isMounted) {
          console.error("Failed to fetch all people:", err);
        }
      }
    };
    
    fetchPeople();
    
    return () => {
      isCancelled = true;
      source.cancel('Component unmounted');
    };
  }, [departments, connectionId, isMounted]);

  const slackTeamId = useMemo(() => departments.find(d => d.id === departmentId)?.slackTeamId || '', [departments, departmentId]);

  // Fetch people and roles for this department
  useEffect(() => {
    if (!slackTeamId || !departmentId) {
      console.log('DepartmentDetails: Missing slackTeamId or departmentId, cannot load people', 
        { slackTeamId, departmentId });
      if (isMounted && departments.length > 0) {
        setLoadingError('Department not found or invalid department ID.');
        setLoading(false);
      }
      return;
    }
    
    setLoadingStep('Loading department people and roles...');
    console.log('DepartmentDetails: Fetching department people with:', { departmentId, slackTeamId });
    setLoading(true);
    let isCancelled = false;
    const source = axios.CancelToken.source();
    
    const fetchDepartmentPeople = async () => {
      try {
        const res = await axios.get(
          `/api/analysis/department-people?department=${encodeURIComponent(departmentId)}&slackTeamId=${encodeURIComponent(slackTeamId)}`,
          { cancelToken: source.token }
        );
        
        if (isCancelled || !isMounted) return;
        
        console.log('DepartmentDetails: Received department people data:', res.data);
        setPeople(res.data.people || []);
        setAssignments(res.data.assignments || {});
        // If backend returns managerAssignments, set it; else, fallback to empty
        setManagerAssignments(res.data.managerAssignments || {});
        setRoles(res.data.roles || []);
        setLoading(false);
      } catch (err) {
        if (!axios.isCancel(err) && isMounted) {
          console.error("Failed to fetch department people:", err);
          setLoadingError(`Failed to fetch department people: ${err.message}`);
          setLoading(false);
        }
      }
    };
    
    fetchDepartmentPeople();
    
    return () => {
      isCancelled = true;
      source.cancel('Component unmounted');
    };
  }, [departmentId, slackTeamId, isMounted, departments.length]);

  // Tree layout function using Dagre - memoized
  const treeLayout = useCallback(() => {
    if (!people.length) return;

    // Create a new directed graph
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    // Configure the graph to layout from top to bottom
    dagreGraph.setGraph({ 
      rankdir: 'TB',
      align: 'UL', 
      ranker: 'network-simplex',
      nodesep: 80,  // Horizontal spacing between nodes
      ranksep: 120, // Vertical spacing between ranks (layers)
      edgesep: 20,  // Minimum separation between edges
      marginx: 20,  // Margin in the x direction
      marginy: 20   // Margin in the y direction
    });

    // Node dimensions - must be consistent for proper layout
    const nodeWidth = 180;
    const nodeHeight = 60;

    // Add all nodes to the dagre graph
    people.forEach(person => {
      dagreGraph.setNode(person.id, { width: nodeWidth, height: nodeHeight });
    });

    // Add all edges to the dagre graph
    people.forEach(person => {
      const managerId = managerAssignments[person.id];
      if (managerId) {
        dagreGraph.setEdge(managerId, person.id);
      }
    });

    // Run the layout algorithm
    dagre.layout(dagreGraph);

    // Create React Flow nodes from the dagre layout result
    const newNodes = people.map(person => {
      const nodeWithPosition = dagreGraph.node(person.id);
      
      // Account for the node dimensions - ReactFlow node positions reference the top-left corner
      // while dagre positions reference the center of the node
      return {
        id: person.id,
        type: 'person',
        data: { label: capitalizeName(person.name) },
        position: {
          x: nodeWithPosition.x - nodeWidth / 2,
          y: nodeWithPosition.y - nodeHeight / 2
        },
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom
      };
    });

    // Create edges
    const newEdges = [];
    people.forEach(person => {
      const managerId = managerAssignments[person.id];
      if (managerId) {
        newEdges.push({
          id: `${managerId}->${person.id}`,
          source: managerId,
          target: person.id,
          type: 'smoothstep', // Use smoothstep for cleaner edges
          animated: false
        });
      }
    });

    // Update state
    setNodes(newNodes);
    setEdges(newEdges);

  }, [people, managerAssignments, setNodes, setEdges]);

  // Organization view layout using Dagre for departments
  const buildOrganizationView = useCallback(() => {
    if (!allDepartments.length || !allPeople.length) return;
    
    // Create a new directed graph for organization layout
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    
    // Configure the graph layout
    dagreGraph.setGraph({
      rankdir: 'TB',
      align: 'UL',
      ranker: 'network-simplex',
      nodesep: 100, // Horizontal spacing
      ranksep: 150, // Vertical spacing
      edgesep: 30,  // Edge separation
      marginx: 50,  // Margin X
      marginy: 50   // Margin Y
    });
    
    // Node dimensions
    const nodeWidth = 220;
    const nodeHeight = 120;
    
    // Color palette for departments
    const colorPalette = [
      { bg: '#f0f4ff', border: '#4f46e5' }, // indigo
      { bg: '#fff1f2', border: '#e11d48' }, // rose
      { bg: '#f0fdf4', border: '#16a34a' }, // green
      { bg: '#f4f4f5', border: '#71717a' }, // zinc
      { bg: '#fef2f2', border: '#dc2626' }, // red
      { bg: '#eff6ff', border: '#2563eb' }, // blue
      { bg: '#fdf4ff', border: '#c026d3' }, // fuchsia
    ];
    
    // Add nodes to the dagre graph
    allDepartments.forEach((dept, index) => {
      dagreGraph.setNode(dept.id, { width: nodeWidth, height: nodeHeight });
    });
    
    // Add edges based on reporting relationships
    for (let i = 0; i < allDepartments.length; i++) {
      for (let j = 0; j < allDepartments.length; j++) {
        if (i === j) continue;
        
        const dept1 = allDepartments[i];
        const dept2 = allDepartments[j];
        const manager1 = departmentManagers[dept1.id];
        const manager2 = departmentManagers[dept2.id];
        
        if (manager1 && manager2) {
          // Check if managers have a reporting relationship
          if (managerAssignments[manager1] === manager2) {
            dagreGraph.setEdge(dept2.id, dept1.id); // Manager 1 reports to Manager 2
          }
          else if (managerAssignments[manager2] === manager1) {
            dagreGraph.setEdge(dept1.id, dept2.id); // Manager 2 reports to Manager 1
          }
        }
      }
    }
    
    // Run the layout algorithm
    dagre.layout(dagreGraph);
    
    // Create React Flow nodes from the dagre layout
    const deptNodes = allDepartments.map((dept, index) => {
      const nodeWithPosition = dagreGraph.node(dept.id);
      const color = colorPalette[index % colorPalette.length];
      
      // Count people in this department
      const peopleInDept = allPeople.filter(p => dept.peopleIds?.includes(p.id));
      
      // Get the department manager
      const managerId = departmentManagers[dept.id];
      const manager = allPeople.find(p => p.id === managerId);
      
      return {
        id: `dept-${dept.id}`,
        type: 'department',
        data: {
          label: dept.name,
          peopleCount: peopleInDept.length,
          managerId: managerId,
          managerName: manager?.name,
          bgColor: color.bg,
          borderColor: color.border
        },
        position: {
          x: nodeWithPosition.x - nodeWidth / 2,
          y: nodeWithPosition.y - nodeHeight / 2
        },
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom
      };
    });
    
    // Create edges between departments
    const deptEdges = [];
    
    // Reporting relationship edges
    allDepartments.forEach(dept1 => {
      allDepartments.forEach(dept2 => {
        if (dept1.id === dept2.id) return;
        
        const manager1 = departmentManagers[dept1.id];
        const manager2 = departmentManagers[dept2.id];
        
        if (manager1 && manager2) {
          // Check if managers have a reporting relationship
          if (managerAssignments[manager1] === manager2) {
            deptEdges.push({
              id: `reporting-${dept1.id}-${dept2.id}`,
              source: `dept-${dept2.id}`,
              target: `dept-${dept1.id}`,
              type: 'smoothstep',
              animated: false,
              style: { stroke: '#4f46e5', strokeWidth: 2 },
              label: 'Reports To',
              labelStyle: { fill: '#1f2937', fontSize: 12 },
              labelBgPadding: [8, 4],
              labelBgBorderRadius: 4,
              labelBgStyle: { fill: '#fff', fillOpacity: 0.7 }
            });
          }
        }
      });
    });
    
    // Find common managers between departments
    for (let i = 0; i < allDepartments.length; i++) {
      for (let j = i + 1; j < allDepartments.length; j++) {
        const dept1 = allDepartments[i];
        const dept2 = allDepartments[j];
        const manager1 = departmentManagers[dept1.id];
        const manager2 = departmentManagers[dept2.id];
        
        if (manager1 && manager2 && manager1 === manager2) {
          // These departments share a manager
          deptEdges.push({
            id: `common-manager-${dept1.id}-${dept2.id}`,
            source: `dept-${dept1.id}`,
            target: `dept-${dept2.id}`,
            type: 'smoothstep',
            animated: false,
            style: { 
              stroke: '#4f46e5',
              strokeWidth: 2,
              strokeDasharray: '4, 4'
            },
            label: 'Common Manager',
            labelStyle: { fill: '#4f46e5', fontSize: 12 },
            labelBgPadding: [8, 4],
            labelBgBorderRadius: 4,
            labelBgStyle: { fill: '#f0f4ff', fillOpacity: 0.7 }
          });
        }
      }
    }
    
    setOrgNodes(deptNodes);
    setOrgEdges(deptEdges);
  }, [allDepartments, allPeople, departmentManagers, managerAssignments, setOrgNodes, setOrgEdges]);

  // Initial layout on mount or when people/managerAssignments change
  useEffect(() => {
    if (people.length && isMounted && activeView === 'department') {
      treeLayout();
    }
  }, [people, managerAssignments, isMounted, activeView, treeLayout]);
  
  // Build organization view when needed
  useEffect(() => {
    if (activeView === 'organization' && isMounted && allDepartments.length && allPeople.length) {
      buildOrganizationView();
    }
  }, [activeView, buildOrganizationView, allDepartments.length, allPeople.length, isMounted]);

  const handleRoleChange = useCallback((userId, role) => {
    setAssignments(prev => ({ ...prev, [userId]: role }));
  }, []);

  const handleDepartmentManagerChange = useCallback((departmentId, managerId) => {
    setDepartmentManagers(prev => ({ ...prev, [departmentId]: managerId }));
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    setSuccess(false);
    setError('');
    
    // Save both individual assignments and department managers
    const savePromises = [
      axios.post('/api/analysis/department-roles', {
        department: departmentId,
        assignments,
        managerAssignments,
        slackTeamId
      }),
      axios.post('/api/analysis/department-managers', {
        connectionId,
        managers: departmentManagers
      })
    ];
    
    Promise.all(savePromises)
      .then(() => {
        if (!isMounted) return;
        
        setSuccess(true);
        setSaving(false);
        
        // Show success snackbar
        setSnackbar({
          isVisible: true,
          message: 'Department structure saved successfully!',
          type: 'success'
        });
        
        // Refresh organization view after saving
        if (activeView === 'organization') {
          buildOrganizationView();
        }
      })
      .catch((error) => {
        if (!isMounted) return;
        
        console.error('Error saving department structure:', error);
        setError('Failed to save department structure.');
        setSaving(false);
        
        // Show error snackbar
        setSnackbar({
          isVisible: true,
          message: 'Failed to save department structure.',
          type: 'error'
        });
      });
  }, [assignments, departmentId, slackTeamId, managerAssignments, connectionId, departmentManagers, isMounted, activeView, buildOrganizationView]);

  const hasCycle = useCallback((assignments, source, target) => {
    // Check if assigning source as manager of target would create a cycle
    let current = source;
    while (assignments[current]) {
      if (assignments[current] === target) return true;
      current = assignments[current];
    }
    return false;
  }, []);

  const handleConnect = useCallback((params) => {
    // params: { source, target }
    if (params.source && params.target && params.source !== params.target) {
      // Prevent cycles
      if (hasCycle(managerAssignments, params.source, params.target)) {
        setInvalidEdgeSnackbar({ 
          isVisible: true, 
          message: 'Invalid: This would create a cycle.' 
        });
        
        return;
      }
      
      if (activeView === 'department') {
        setManagerAssignments(prev => ({
          ...prev,
          [params.target]: params.source
        }));
      } else {
        // Handle connections between departments in organization view
        // Extract department IDs from node IDs (remove the 'dept-' prefix)
        const sourceDeptId = params.source.replace('dept-', '');
        const targetDeptId = params.target.replace('dept-', '');
        
        // Set the manager of the target department to be the same as the source department
        const sourceManager = departmentManagers[sourceDeptId];
        if (sourceManager) {
          setDepartmentManagers(prev => ({
            ...prev,
            [targetDeptId]: sourceManager
          }));
        }
      }
    } else {
      setInvalidEdgeSnackbar({ 
        isVisible: true, 
        message: 'Invalid connection.' 
      });
    }
  }, [managerAssignments, activeView, departmentManagers, hasCycle]);

  // Edge deletion handler
  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation();
    
    if (activeView === 'department') {
      setManagerAssignments(prev => {
        const updated = { ...prev };
        delete updated[edge.target];
        return updated;
      });
    } else {
      // For organization view, remove the reporting relationship
      const targetDeptId = edge.target.replace('dept-', '');
      setDepartmentManagers(prev => {
        const updated = { ...prev };
        delete updated[targetDeptId];
        return updated;
      });
    }
  }, [activeView]);

  const resetLayout = useCallback(() => {
    if (activeView === 'department') {
      treeLayout();
    } else {
      buildOrganizationView();
    }
  }, [activeView, treeLayout, buildOrganizationView]);

  return (
    <div className="department-details-container">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb">
        <button onClick={() => navigate('/orgchart')} className="breadcrumb-item">
          <Home size={16} />
          <span>Organization</span>
        </button>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span className="breadcrumb-item active">
          <Building size={16} />
          <span>{departmentDisplayName}</span>
        </span>
      </div>
      
      {/* Department Header */}
      <div className="department-header">
        <h2>{departmentDisplayName} Department</h2>
        <div className="action-buttons">
          <button 
            onClick={resetLayout}
            className="secondary-button"
            title="Reset the chart layout"
          >
            <RefreshCw size={16} />
            <span>Reset Layout</span>
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving} 
            className={`primary-button ${saving ? 'saving' : ''}`}
          >
            {saving ? (
              <>
                <span className="spinner" />
                Saving...
              </>
            ) : (
              <>
                <Save size={16} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="view-tabs">
        <button 
          className={`view-tab ${activeView === 'department' ? 'active' : ''}`}
          onClick={() => setActiveView('department')}
        >
          <Users size={16} />
          <span>Department View</span>
        </button>
        <button 
          className={`view-tab ${activeView === 'organization' ? 'active' : ''}`}
          onClick={() => setActiveView('organization')}
        >
          <Network size={16} />
          <span>Organization View</span>
        </button>
      </div>

      {/* Render snackbars */}
      <SimpleSnackbar 
        message={snackbar.message}
        type={snackbar.type}
        isVisible={snackbar.isVisible}
        onClose={closeSnackbar}
        duration={5000}
      />
      
      <SimpleSnackbar
        message={invalidEdgeSnackbar.message}
        type="error"
        isVisible={invalidEdgeSnackbar.isVisible}
        onClose={closeInvalidEdgeSnackbar}
        duration={3000}
      />
      
      {loading ? (
        <LoadingSpinner message={loadingStep} />
      ) : loadingError ? (
        <ErrorMessage 
          message={loadingError} 
          onBackClick={() => navigate('/orgchart')} 
        />
      ) : (
        <>
          {/* Department View */}
          {activeView === 'department' && (
            <>
              {/* Org Chart Visualization */}
              <div className="org-chart-panel">
                <div className="panel-header">
                  <h3>Department Hierarchy</h3>
                  <div className="panel-subtitle">Drag connections between nodes to assign managers</div>
                </div>
                <div className="flow-container">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onConnect={handleConnect}
                    onEdgeClick={onEdgeClick}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodesDraggable={true}
                    nodesConnectable={true}
                    elementsSelectable={true}
                    fitView
                    nodeTypes={nodeTypes}
                    zoomOnDoubleClick={false}
                    minZoom={0.5}
                    maxZoom={2}
                  >
                    <Background variant="dots" gap={12} size={1} />
                    <Controls />
                    <MiniMap nodeStrokeWidth={3} zoomable pannable />
                  </ReactFlow>
                </div>
              </div>

              {/* People and Roles Table */}
              <div className="roles-panel">
                <div className="panel-header">
                  <h3>Team Roster & Roles</h3>
                  <div className="panel-subtitle">Assign roles and reporting relationships</div>
                </div>
                
                <div className="table-container">
                  <table className="people-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Reports To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.length === 0 ? (
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'center', padding: '2rem' }}>
                            No people found in this department
                          </td>
                        </tr>
                      ) : (
                        people.map(person => (
                          <tr key={person.id}>
                            <td className="person-name-cell">{capitalizeName(person.name)}</td>
                            <td>
                              <select 
                                value={assignments[person.id] || ''} 
                                onChange={e => handleRoleChange(person.id, e.target.value)}
                                className="role-select"
                              >
                                <option value="">Select Role</option>
                                {roles.map(role => (
                                  <option key={role.name} value={role.name}>{role.name}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={managerAssignments[person.id] || ''}
                                onChange={e => setManagerAssignments(prev => ({ ...prev, [person.id]: e.target.value }))}
                                className="manager-select"
                              >
                                <option value="">None</option>
                                {people.filter(p => p.id !== person.id).map(p => (
                                  <option key={p.id} value={p.id}>{capitalizeName(p.name)}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          
          {/* Organization View */}
          {activeView === 'organization' && (
            <>
              <div className="org-chart-panel">
                <div className="panel-header">
                  <h3>Organization Structure</h3>
                  <div className="panel-subtitle">View department relationships and assign department managers</div>
                </div>
                <div className="flow-container">
                  <ReactFlow
                    nodes={orgNodes}
                    edges={orgEdges}
                    onConnect={handleConnect}
                    onEdgeClick={onEdgeClick}
                    onNodesChange={onOrgNodesChange}
                    onEdgesChange={onOrgEdgesChange}
                    nodesDraggable={true}
                    nodesConnectable={true}
                    elementsSelectable={true}
                    fitView
                    nodeTypes={nodeTypes}
                    zoomOnDoubleClick={false}
                    minZoom={0.5}
                    maxZoom={2}
                  >
                    <Background variant="dots" gap={12} size={1} />
                    <Controls />
                    <MiniMap nodeStrokeWidth={3} zoomable pannable />
                  </ReactFlow>
                </div>
              </div>

              {/* Department Managers Table */}
              <div className="roles-panel">
                <div className="panel-header">
                  <h3>Department Managers</h3>
                  <div className="panel-subtitle">Assign managers to departments</div>
                </div>
                
                <div className="table-container">
                  <table className="people-table">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Manager</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allDepartments.length === 0 ? (
                        <tr>
                          <td colSpan="2" style={{ textAlign: 'center', padding: '2rem' }}>
                            No departments found
                          </td>
                        </tr>
                      ) : (
                        allDepartments.map(dept => (
                          <tr key={dept.id}>
                            <td className="person-name-cell">
                              <div className="dept-cell">
                                <Building size={16} />
                                <span>{dept.name}</span>
                              </div>
                            </td>
                            <td>
                              <select
                                value={departmentManagers[dept.id] || ''}
                                onChange={e => handleDepartmentManagerChange(dept.id, e.target.value)}
                                className="manager-select"
                              >
                                <option value="">Select Manager</option>
                                {allPeople.map(person => (
                                  <option key={person.id} value={person.id}>{capitalizeName(person.name)}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default DepartmentDetails; 