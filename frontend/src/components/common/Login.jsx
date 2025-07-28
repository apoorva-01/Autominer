import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Slack, Eye, EyeOff } from 'lucide-react';

function Login() {
  const { login, register, isAuthenticated } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [snackbar, setSnackbar] = useState({ isVisible: false, message: '', type: 'error' });

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = isRegistering
        ? await register(formData.email, formData.password, formData.name)
        : await login(formData.email, formData.password);

      if (!result.success) {
        setSnackbar({
          isVisible: true,
          message: result.error,
          type: 'error'
        });
      }
    } catch (err) {
      setSnackbar({
        isVisible: true,
        message: 'An unexpected error occurred',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const closeSnackbar = () => {
    setSnackbar(prev => ({ ...prev, isVisible: false }));
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-card-body">
          <div className="login-logo-container">
            <div className="login-logo">
              <Slack size={32} />
            </div>
          </div>
          
          <h1 className="login-title">AutoMiner</h1>
          <p className="login-subtitle">
            Discover automation opportunities from your Slack conversations
          </p>

          {snackbar.isVisible && (
            <div className={`snackbar ${snackbar.type} visible`}>
              <span>{snackbar.message}</span>
              <button className="snackbar-close" onClick={closeSnackbar}>×</button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            {isRegistering && (
              <div className="form-group">
                <label htmlFor="name" className="form-label">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Enter your name"
                  className="form-input"
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email" className="form-label">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="you@example.com"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">
                Password
              </label>
              <div className="password-input-container">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  placeholder="••••••••"
                  className="form-input"
                />
                <button 
                  type="button" 
                  className="password-toggle-btn"
                  onClick={togglePasswordVisibility}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="login-button"
            >
              {loading ? (
                <div>
                  <svg className="button-spinner" width="20" height="20" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Processing...</span>
                </div>
              ) : (
                <span>{isRegistering ? 'Create Account' : 'Sign In'}</span>
              )}
            </button>
          </form>

          <div className="login-footer">
            <p>
              {isRegistering ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => setIsRegistering(!isRegistering)}
                className="toggle-auth-btn"
              >
                {isRegistering ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login; 