import React from 'react';
import './Skeleton.css';

const Skeleton = ({ width = '100%', height = '1em', style = {}, className = '', shape = 'default' }) => {
  let shapeClass = '';
  if (shape === 'rounded') shapeClass = 'rounded';
  if (shape === 'circle') shapeClass = 'circle';

  return (
    <div
      className={`skeleton-loader ${shapeClass} ${className}`}
      style={{ width, height, ...style }}
      data-testid="skeleton-loader"
    />
  );
};

export default Skeleton; 