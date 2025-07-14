import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  BarChart3, 
  Slack, 
  FileText, 
  Settings, 
  LogOut,
  Home,
  Users,
  Shield
} from 'lucide-react';

function Navigation() {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/slack-connect', label: 'Slack Connect', icon: Slack },
  ];

  const adminNavItems = [
    { path: '/admin', label: 'Admin Dashboard', icon: Shield },
    { path: '/analysis', label: 'Analysis', icon: BarChart3 },
    { path: '/reports', label: 'Reports', icon: FileText },
  ];

  return (
    <nav className="navigation">
      <div className="nav-header">
        <h1>AutoMiner</h1>
        <p>Automation Discovery</p>
      </div>

      <ul className="nav-links">
        {/* <li className="nav-section-heading">MENU</li> */}
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
          return (
            <li key={item.path}>
              <Link 
                to={item.path} 
                className={isActive ? 'active' : ''}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            </li>
          );
        })}
        
        {isAdmin && (
          <>
            <li className="nav-divider" />
            {/* <li className="nav-section-heading">ADMIN</li> */}
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <li key={item.path}>
                  <Link 
                    to={item.path} 
                    className={isActive ? 'active admin' : 'admin'}
                  >
                    <Icon size={20} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </>
        )}
      </ul>

      <div className="nav-footer">
        <div className="user-info">
          {/* <div className="user-avatar">
            {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase()}
          </div> */}
          <div className="user-details">
            <h4>{user?.name || 'User'}</h4>
            <p>{user?.email}</p>
            <span className={`user-role ${user?.role}`}>
              {user?.role?.toUpperCase()}
            </span>
          </div>
        </div>
        <button onClick={logout} className="logout-button">
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </nav>
  );
}

export default Navigation; 