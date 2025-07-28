import React, { useState, useEffect } from 'react';
import Navigation from './Navigation';
import { FiMenu } from 'react-icons/fi';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from 'react-query';

// Layout component - main layout wrapper for the application
const Layout = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // Handle sidebar toggle
  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
    // Store preference in localStorage
    localStorage.setItem('sidebarCollapsed', !sidebarCollapsed);
  };
  
  // Handle mobile menu toggle
  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };
  
  // Load sidebar state from localStorage on component mount
  useEffect(() => {
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      setSidebarCollapsed(savedState === 'true');
    }
  }, []);
  
  // Effect to force refetch data when route changes
  useEffect(() => {
    // Reset the cache and refetch all common queries
    queryClient.resetQueries();
    
    // Specific queries we know are important
    queryClient.invalidateQueries('admin-connections');
    queryClient.invalidateQueries('admin-users');
    queryClient.invalidateQueries('admin-all-channel-selections');
    queryClient.invalidateQueries('analysis-summary');
    queryClient.invalidateQueries('dashboard-stats');
    queryClient.invalidateQueries('recent-reports');
  }, [location.pathname, queryClient]);
  
  return (
    <div className="app-layout">
      <Navigation 
        collapsed={sidebarCollapsed} 
        onToggle={toggleSidebar}
        isOpen={isMobileMenuOpen}
        onMobileToggle={toggleMobileMenu}
      />
      
      {/* Mobile menu toggle button */}
      <button 
        className="mobile-toggle-btn" 
        onClick={toggleMobileMenu}
        aria-label="Toggle mobile menu"
      >
        <FiMenu className="w-6 h-6" />
      </button>
      
      {/* Navigation overlay for mobile */}
      {isMobileMenuOpen && (
        <div 
          className={`sidebar-overlay ${isMobileMenuOpen ? 'visible' : ''}`}
          onClick={toggleMobileMenu}
        ></div>
      )}
      
      <main className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
        <div className="content-container">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout; 