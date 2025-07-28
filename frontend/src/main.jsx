import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import App from './App';
import './index.css'; // Use stylesheet with Tailwind directives
import { DepartmentsProvider } from './contexts/DepartmentsContext';
import { AuthProvider } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0, // Always fetch fresh data
      cacheTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: true,
      refetchOnMount: 'always', // Always refetch when component mounts
      refetchOnReconnect: true,
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DepartmentsProvider>
          <WorkspaceProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </WorkspaceProvider>
        </DepartmentsProvider>
      </AuthProvider>
    </QueryClientProvider>
  // </React.StrictMode>
); 