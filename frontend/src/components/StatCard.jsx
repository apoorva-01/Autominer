import React from 'react';

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
    <div className={`stat-card stat-card--${accent}`}>
      <div className={`stat-card__icon stat-card__icon--${accent}`}>
        {Icon && <Icon size={28} />}
      </div>
      <div className="stat-card__info">
        <div className="stat-card__value">{value}</div>
        <div className="stat-card__label">{label}</div>
        {status && (
          <div className={`stat-card__status stat-card__status--${statusColor}`}>{status}</div>
        )}
        {children}
      </div>
    </div>
  );
}

export default StatCard; 