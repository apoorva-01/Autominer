import React, { useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';

function Snackbar({ message, type = 'success', isVisible, onClose, duration = 3000 }) {
  useEffect(() => {
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle size={20} />;
      case 'error':
        return <XCircle size={20} />;
      case 'warning':
        return <AlertCircle size={20} />;
      default:
        return <CheckCircle size={20} />;
    }
  };

  const getTypeClass = () => {
    switch (type) {
      case 'success':
        return 'snackbar-success';
      case 'error':
        return 'snackbar-error';
      case 'warning':
        return 'snackbar-warning';
      default:
        return 'snackbar-success';
    }
  };

  return (
    <div className={`snackbar ${getTypeClass()}`}>
      <div className="snackbar-content">
        <div className="snackbar-icon">
          {getIcon()}
        </div>
        <div className="snackbar-message">
          {message}
        </div>
        <button className="snackbar-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default Snackbar; 