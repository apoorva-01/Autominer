import React, { useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

const SimpleSnackbar = ({ message, type = 'success', isVisible, onClose, duration = 3000 }) => {
  useEffect(() => {
    // Auto-dismiss after specified duration
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        if (onClose) {
          onClose();
        }
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;
  
  const backgroundColor = type === 'success' ? '#10b981' : '#ef4444';
  const icon = type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />;
  
  return (
    <div 
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor,
        color: 'white',
        padding: '12px 16px',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: '300px',
        animation: 'fade-in 0.3s ease-in-out'
      }}
    >
      <div>{icon}</div>
      <div style={{ flex: 1 }}>{message}</div>
      <button 
        onClick={onClose} 
        style={{ 
          background: 'transparent', 
          border: 'none', 
          color: 'white',
          cursor: 'pointer', 
          display: 'flex', 
          alignItems: 'center',
          padding: '4px'
        }}
        aria-label="Close notification"
      >
        <X size={16} />
      </button>
    </div>
  );
};

// Add the keyframe animation to the document
const injectStyle = () => {
  // Only add the style if it doesn't exist yet
  if (!document.getElementById('simple-snackbar-styles')) {
    const style = document.createElement('style');
    style.id = 'simple-snackbar-styles';
    style.innerHTML = `
      @keyframes fade-in {
        from { opacity: 0; transform: translate(-50%, 20px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    document.head.appendChild(style);
  }
};

// Call the function to inject styles
injectStyle();

export default SimpleSnackbar; 