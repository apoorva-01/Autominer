import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext();

export function WorkspaceProvider({ children }) {
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Load workspaces when authenticated
  useEffect(() => {
    // Only fetch workspaces when authentication is complete and user is logged in
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    
    async function fetchWorkspaces() {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get('/api/slack/admin/connections', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const connections = response.data.connections || [];
        
        // Deduplicate workspaces by slackTeamId
        const uniqueWorkspaces = Object.values(
          connections.reduce((acc, conn) => {
            if (!acc[conn.slackTeamId]) {
              acc[conn.slackTeamId] = conn;
            }
            return acc;
          }, {})
        );
        
        setWorkspaces(uniqueWorkspaces);
        
        // Try to load from localStorage or select the first workspace
        const savedWorkspaceId = localStorage.getItem('selectedWorkspace');
        if (savedWorkspaceId) {
          const savedWorkspace = uniqueWorkspaces.find(ws => ws.id === savedWorkspaceId);
          if (savedWorkspace) {
            setSelectedWorkspace(savedWorkspace);
          } else if (uniqueWorkspaces.length > 0) {
            setSelectedWorkspace(uniqueWorkspaces[0]);
            localStorage.setItem('selectedWorkspace', uniqueWorkspaces[0].id);
          }
        } else if (uniqueWorkspaces.length > 0) {
          setSelectedWorkspace(uniqueWorkspaces[0]);
          localStorage.setItem('selectedWorkspace', uniqueWorkspaces[0].id);
        }
        
      } catch (error) {
        console.error('Failed to fetch workspaces:', error);
        setError(error);
        // If we get a 401, the token might be expired - don't break the app
        if (error.response?.status === 401) {
          setWorkspaces([]);
          setSelectedWorkspace(null);
        }
      } finally {
        setLoading(false);
      }
    }
    
    fetchWorkspaces();
  }, [isAuthenticated, user, authLoading]);
  
  // Update localStorage when selected workspace changes
  useEffect(() => {
    if (selectedWorkspace) {
      localStorage.setItem('selectedWorkspace', selectedWorkspace.id);
    }
  }, [selectedWorkspace]);
  
  const selectWorkspace = (workspaceId) => {
    const workspace = workspaces.find(ws => ws.id === workspaceId);
    setSelectedWorkspace(workspace || null);
  };
  
  // Manual refresh method to reload workspaces
  const refreshWorkspaces = async () => {
    if (!isAuthenticated) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/slack/admin/connections', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const connections = response.data.connections || [];
      
      // Same deduplication logic
      const uniqueWorkspaces = Object.values(
        connections.reduce((acc, conn) => {
          if (!acc[conn.slackTeamId]) {
            acc[conn.slackTeamId] = conn;
          }
          return acc;
        }, {})
      );
      
      setWorkspaces(uniqueWorkspaces);
      
      // If no workspace is selected but we have workspaces, select the first one
      if (!selectedWorkspace && uniqueWorkspaces.length > 0) {
        setSelectedWorkspace(uniqueWorkspaces[0]);
        localStorage.setItem('selectedWorkspace', uniqueWorkspaces[0].id);
      }
      
    } catch (error) {
      console.error('Failed to refresh workspaces:', error);
      setError(error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <WorkspaceContext.Provider 
      value={{ 
        workspaces, 
        selectedWorkspace, 
        selectWorkspace, 
        loading,
        error,
        refreshWorkspaces
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
} 