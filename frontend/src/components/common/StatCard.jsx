import React from 'react';
import { TrendingUp } from 'lucide-react';

function StatCard({
  icon: Icon,
  value,
  label,
  accent = 'primary',
  status,
  statusColor = 'default',
  children
}) {
  return (
    <div className={`stat-card ${accent}`}>
      <div className={`stat-card-icon ${accent}`}>
        {Icon && <Icon size={20} />}
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      {status && (
        <div className={`stat-card-status ${statusColor}`}>
          {statusColor === 'success' && <TrendingUp size={12} />}
          {status}
        </div>
      )}
      {children}
    </div>
  );
}

export default StatCard; 