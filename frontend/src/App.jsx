import React, { useEffect, Suspense, lazy } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { useAuth } from './contexts/AuthContext';

// Layouts
import Layout from './components/common/Layout';

// Common components
import Login from './components/common/Login';

// User pages
import UserDashboard from './components/user/UserDashboard';
import UserSlackConnect from './components/user/UserSlackConnect';

// Admin pages - use lazy loading
const AdminDashboard = React.lazy(() => import('./components/admin/AdminDashboard'));
const AdminControlDashboard = React.lazy(() => import('./components/admin/AdminControlDashboard'));
const OrganizationView = React.lazy(() => import('./components/admin/OrganizationView'));
const AdminOrgChart = React.lazy(() => import('./components/admin/AdminOrgChart'));
const Analysis = React.lazy(() => import('./components/admin/Analysis'));
const Automations = React.lazy(() => import('./components/admin/Automations'));
const Reports = React.lazy(() => import('./components/admin/Reports'));
const Settings = React.lazy(() => import('./components/admin/Settings'));
const SlackConnect = React.lazy(() => import('./components/admin/SlackConnect'));
const DepartmentDetails = React.lazy(() => import('./components/admin/DepartmentDetails'));

// Loading component
const LoadingFallback = () => (
  <div className="loading-container">
    <div className="loading-spinner"></div>
    <p>Loading...</p>
  </div>
);

// Protected route wrapper
const ProtectedRoute = ({ children, adminOnly }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // Effect to invalidate cache when route changes
  useEffect(() => {
    // Force refetch all common queries when route changes
    queryClient.invalidateQueries('admin-connections');
    queryClient.invalidateQueries('admin-users');
    queryClient.invalidateQueries('admin-all-channel-selections');
    queryClient.invalidateQueries('analysis-summary');
    queryClient.invalidateQueries('dashboard-stats');
  }, [location.pathname, queryClient]);
  
  // Show consistent loading state
  if (loading) {
    return <LoadingFallback />;
  }
  
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

function App() {
  const { user, loading } = useAuth();
  
  // For adjusting the app to be mobile responsive
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      const newMeta = document.createElement('meta');
      newMeta.name = 'viewport';
      newMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(newMeta);
    }
  }, []);
  
  if (loading) {
    return <LoadingFallback />;
  }
  
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        
        {/* Protected routes - these are wrapped with the Layout component */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Layout>
                {user?.role === 'admin' ? 
                  <Suspense fallback={<LoadingFallback />}>
                    <AdminDashboard />
                  </Suspense> : 
                  <UserDashboard />
                }
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/slack-connect" 
          element={
            <ProtectedRoute>
              <Layout>
                {user?.role === 'admin' ? 
                  <Suspense fallback={<LoadingFallback />}>
                    <SlackConnect />
                  </Suspense> : 
                  <UserSlackConnect />
                }
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        {/* Admin-only routes */}
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <AdminControlDashboard />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/organization" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <OrganizationView />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/orgchart" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <AdminOrgChart />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/department/:id" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <DepartmentDetails />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        {/* New route for orgchart/department/:departmentName */}
        <Route 
          path="/orgchart/department/:departmentName" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <DepartmentDetails />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/analysis" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <Analysis />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/automations" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <Automations />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/reports" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <Reports />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/settings" 
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Suspense fallback={<LoadingFallback />}>
                  <Settings />
                </Suspense>
              </Layout>
            </ProtectedRoute>
          } 
        />
        
        {/* Redirect any unknown routes to home */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
}

export default App; 