import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ 
  icon: Icon, 
  title, 
  description, 
  actionLabel, 
  onAction,
  children
}) => {
  return (
    <div className="empty-state-card">
      <div className="empty-state-icon-wrapper">
        <Icon size={32} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      
      {actionLabel && onAction && (
        <button onClick={onAction} className="btn btn-primary">
          <Plus size={16} /> {actionLabel}
        </button>
      )}

      {children && (
        <div className="empty-state-children">
          {children}
        </div>
      )}
    </div>
  );
};

