import React, { createContext, useState, useContext, useCallback } from 'react';
import axios from 'axios';

const DepartmentsContext = createContext();

export const useDepartments = () => useContext(DepartmentsContext);

export const DepartmentsProvider = ({ children }) => {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [departmentManagers, setDepartmentManagers] = useState({});
  
  // Fetch departments for a specific workspace
  const fetchDepartments = useCallback(async (idParam) => {
    if (!idParam) return;
    
    setLoading(true);
    setError('');
    
    try {
      // Determine if we're dealing with a connectionId (CUID) or slackTeamId (starts with T)
      const isSlackTeamId = typeof idParam === 'string' && idParam.startsWith('T');
      const paramName = isSlackTeamId ? 'slackTeamId' : 'connectionId';
      
      const response = await axios.get(`/api/analysis/departments?${paramName}=${encodeURIComponent(idParam)}`);
      setDepartments(response.data.departments || []);
      
      // Also fetch department managers
      try {
        const managerResponse = await axios.get(`/api/analysis/department-managers?${paramName}=${encodeURIComponent(idParam)}`);
        setDepartmentManagers(managerResponse.data.managers || {});
      } catch (managerErr) {
        console.error("Failed to fetch department managers:", managerErr);
      }
      
    } catch (err) {
      console.error("Failed to fetch departments:", err);
      setError('Failed to fetch departments');
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Create a new department
  const createDepartment = useCallback(async (idParam, name) => {
    if (!idParam || !name) return null;
    
    // Determine if we're dealing with a connectionId or slackTeamId
    const isSlackTeamId = typeof idParam === 'string' && idParam.startsWith('T');
    const paramName = isSlackTeamId ? 'slackTeamId' : 'connectionId';
    
    try {
      const response = await axios.post('/api/analysis/departments', {
        [paramName]: idParam,
        name,
      });
      
      // Refresh departments list
      fetchDepartments(idParam);
      
      return response.data.department;
    } catch (err) {
      console.error("Failed to create department:", err);
      setError('Failed to create department');
      return null;
    }
  }, [fetchDepartments]);
  
  // Update department manager
  const updateDepartmentManager = useCallback(async (departmentId, managerId, idParam) => {
    if (!departmentId) return false;
    
    // Determine if we're dealing with a connectionId or slackTeamId
    const isSlackTeamId = typeof idParam === 'string' && idParam.startsWith('T');
    const paramName = isSlackTeamId ? 'slackTeamId' : 'connectionId';
    
    try {
      const update = { [departmentId]: managerId };
      
      await axios.post('/api/analysis/department-managers', {
        [paramName]: idParam,
        managers: update
      });
      
      // Update local state
      setDepartmentManagers(prev => ({
        ...prev,
        ...update
      }));
      
      return true;
    } catch (err) {
      console.error("Failed to update department manager:", err);
      setError('Failed to update department manager');
      return false;
    }
  }, []);
  
  // Get department members
  const getDepartmentMembers = useCallback(async (departmentId, slackTeamId) => {
    if (!departmentId || !slackTeamId) return [];
    
    try {
      const response = await axios.get(`/api/analysis/department-people?department=${encodeURIComponent(departmentId)}&slackTeamId=${encodeURIComponent(slackTeamId)}`);
      return response.data.people || [];
    } catch (err) {
      console.error("Failed to fetch department members:", err);
      return [];
    }
  }, []);
  
  // Update department details including name
  const updateDepartment = useCallback(async (departmentId, updates, idParam) => {
    if (!departmentId) return false;
    
    // Determine if we're dealing with a connectionId or slackTeamId
    const isSlackTeamId = typeof idParam === 'string' && idParam.startsWith('T');
    const paramName = isSlackTeamId ? 'slackTeamId' : 'connectionId';
    
    try {
      await axios.post('/api/analysis/departments', {
        id: departmentId,
        ...updates,
        [paramName]: idParam
      });
      
      // Refresh departments list
      fetchDepartments(idParam);
      
      return true;
    } catch (err) {
      console.error("Failed to update department:", err);
      setError('Failed to update department');
      return false;
    }
  }, [fetchDepartments]);
  
  // Delete a department
  const deleteDepartment = useCallback(async (departmentId, idParam) => {
    if (!departmentId) return false;
    
    // Determine if we're dealing with a connectionId or slackTeamId
    const isSlackTeamId = typeof idParam === 'string' && idParam.startsWith('T');
    const paramName = isSlackTeamId ? 'slackTeamId' : 'connectionId';
    
    try {
      // Fix: Use the correct endpoint structure and HTTP method for department deletion
      // The backend expects a DELETE request to /api/analysis/departments with id and slackTeamId in the body
      await axios.delete('/api/analysis/departments', {
        data: { 
          id: departmentId,
          [paramName]: idParam 
        }
      });
      
      // Refresh departments list
      fetchDepartments(idParam);
      
      return true;
    } catch (err) {
      console.error("Failed to delete department:", err);
      setError('Failed to delete department');
      return false;
    }
  }, [fetchDepartments]);
  
  // Find common managers between departments
  const findCommonManagers = useCallback(() => {
    const commonManagers = {};
    
    // Group departments by manager
    Object.entries(departmentManagers).forEach(([deptId, managerId]) => {
      if (!managerId) return;
      
      if (!commonManagers[managerId]) {
        commonManagers[managerId] = [];
      }
      
      commonManagers[managerId].push(deptId);
    });
    
    // Filter out managers that only manage one department
    return Object.fromEntries(
      Object.entries(commonManagers)
        .filter(([_, depts]) => depts.length > 1)
    );
  }, [departmentManagers]);
  
  const contextValue = {
    departments,
    loading,
    error,
    departmentManagers,
    fetchDepartments,
    createDepartment,
    updateDepartmentManager,
    getDepartmentMembers,
    updateDepartment,
    deleteDepartment,
    findCommonManagers
  };
  
  return (
    <DepartmentsContext.Provider value={contextValue}>
      {children}
    </DepartmentsContext.Provider>
  );
};

export default DepartmentsProvider; 