import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight, FiHome, FiSlack, FiShield, 
         FiLogOut, FiUsers, FiBarChart2, FiFileText, FiSettings, FiX, FiGlobe, FiZap } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';

const Navigation = ({ collapsed, onToggle, isOpen, onMobileToggle }) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  
  // Check if a route is active
  const isActive = (path) => {
    return location.pathname === path;
  };
  
  // Get user initials for avatar
  const getUserInitials = () => {
    if (!user?.name) return '?';
    return user.name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };
  
  return (
    <nav className={`navigation ${collapsed ? 'collapsed' : 'expanded'} ${isOpen ? 'mobile-open' : 'mobile-closed'}`}>
      
      {/* Header */}
      <div className="nav-header">
        <button 
          className="nav-toggle-btn"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <FiChevronRight /> : <FiChevronLeft />}
        </button>
        
        {!collapsed && (
          <div className="nav-logo">
            <h1 className="nav-logo-title">AutoMiner</h1>
          </div>
        )}
        
        {/* Mobile close button */}
        {isOpen && (
          <button 
            className="nav-close-btn"
            onClick={onMobileToggle}
            aria-label="Close menu"
          >
            <FiX />
          </button>
        )}
      </div>
      
      {/* Navigation Links */}
      <ul className="nav-links">
        <li>
          <Link 
            to="/" 
            className={`nav-link ${isActive('/') ? 'active' : ''}`}
          >
            <div className="nav-icon">
              <FiHome />
            </div>
            <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Dashboard</span>
          </Link>
        </li>
        
        <li>
          <Link 
            to="/slack-connect" 
            className={`nav-link ${isActive('/slack-connect') ? 'active' : ''}`}
          >
            <div className="nav-icon">
              <FiSlack />
            </div>
            <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Slack Connect</span>
          </Link>
        </li>
        
        {isAdmin && (
          <>
            {/* Admin Divider */}
            {/* <div className="nav-divider"></div> */}
            
            <li>
              <Link 
                to="/admin" 
                className={`nav-link admin ${isActive('/admin') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiShield />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Admin Dashboard</span>
              </Link>
            </li>
            
            {/* <li>
              <Link 
                to="/organization" 
                className={`nav-link admin ${isActive('/organization') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiGlobe />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Organization</span>
              </Link>
            </li> */}
            
            <li>
              <Link 
                to="/orgchart" 
                className={`nav-link admin ${isActive('/orgchart') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiUsers />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Departments</span>
              </Link>
            </li>
            
            <li>
              <Link 
                to="/analysis" 
                className={`nav-link admin ${isActive('/analysis') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiBarChart2 />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>AI Analysis                </span>
              </Link>
            </li>
            
            <li>
              <Link 
                to="/automations" 
                className={`nav-link admin ${isActive('/automations') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiZap />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Automations</span>
              </Link>
            </li>
            
            <li>
              <Link 
                to="/reports" 
                className={`nav-link admin ${isActive('/reports') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiFileText />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Reports</span>
              </Link>
            </li>
            
            <li>
              <Link 
                to="/settings" 
                className={`nav-link admin ${isActive('/settings') ? 'active' : ''}`}
              >
                <div className="nav-icon">
                  <FiSettings />
                </div>
                <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Settings</span>
              </Link>
            </li>
          </>
        )}
      </ul>
      
      {/* Footer */}
      <div className="nav-footer">
        {/* User Section */}
        <div className={`user-section ${collapsed ? 'collapsed' : ''}`}>
          {collapsed ? (
            <div className="user-avatar">
              {getUserInitials()}
            </div>
          ) : (
            <div className="user-info">
              <div className="user-avatar">
                {getUserInitials()}
              </div>
              <div className="user-details">
                <h4 className="user-name">{user?.name || 'User'}</h4>
                <span className={`user-role ${isAdmin ? 'admin' : 'normal'}`}>
                  {isAdmin ? 'ADMIN' : 'USER'}
                </span>
              </div>
            </div>
          )}
        </div>
        
        {/* Logout Button */}
        <button 
          onClick={logout} 
          className="logout-btn"
        >
          <div className="nav-icon">
            <FiLogOut />
          </div>
          <span className={`nav-text ${collapsed ? 'hidden' : ''}`}>Logout</span>
        </button>
      </div>
    </nav>
  );
};

export default Navigation; 