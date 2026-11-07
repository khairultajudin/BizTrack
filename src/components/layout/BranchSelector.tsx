import React, { useState, useRef, useEffect } from 'react';
import { useBranch } from '../../context/BranchContext';
import { Building2, ChevronDown, Check, Lock } from 'lucide-react';

export const BranchSelector: React.FC = () => {
  const {
    activeBranches,
    selectedBranchId,
    selectedBranch,
    isMultiBranch,
    canSelectAll,
    setSelectedBranchId,
  } = useBranch();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // If the workspace does not have multi-branch setup yet, do not display
  if (!isMultiBranch) {
    return null;
  }

  // If user cannot select all and is locked to single branch (e.g. Staff)
  if (!canSelectAll) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#F3F4F6',
          border: '1px solid #E5E7EB',
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '0.8125rem',
          color: '#374151',
          fontWeight: 500,
        }}
        title="Assigned Branch (Fixed)"
      >
        <Building2 size={15} color="#4B5563" />
        <span>{selectedBranch?.name || 'Assigned Branch'}</span>
        <Lock size={12} color="#9CA3AF" />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: selectedBranch ? '#EFF6FF' : '#F9FAFB',
          border: `1px solid ${selectedBranch ? '#BFDBFE' : '#E5E7EB'}`,
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '0.8125rem',
          color: selectedBranch ? '#1D4ED8' : '#374151',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease-in-out',
        }}
        aria-label="Select Branch"
        aria-expanded={isOpen}
      >
        <Building2 size={16} color={selectedBranch ? '#2563EB' : '#6B7280'} />
        <span>{selectedBranch ? selectedBranch.name : 'All Branches'}</span>
        <ChevronDown
          size={14}
          color={selectedBranch ? '#2563EB' : '#9CA3AF'}
          style={{
            transition: 'transform 0.2s',
            transform: isOpen ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: '200px',
            background: '#FFFFFF',
            borderRadius: '8px',
            border: '1px solid #E5E7EB',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            zIndex: 100,
            padding: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              fontSize: '0.6875rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#9CA3AF',
              borderBottom: '1px solid #F3F4F6',
            }}
          >
            Branch Filter
          </div>

          {canSelectAll && (
            <button
              onClick={() => {
                setSelectedBranchId(null);
                setIsOpen(false);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: '6px',
                border: 'none',
                background: selectedBranchId === null ? '#EFF6FF' : 'transparent',
                color: selectedBranchId === null ? '#1D4ED8' : '#374151',
                fontSize: '0.8125rem',
                fontWeight: selectedBranchId === null ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>All Branches</span>
              {selectedBranchId === null && <Check size={14} color="#2563EB" />}
            </button>
          )}

          {activeBranches.map(b => {
            const isSelected = selectedBranchId === b.id;
            return (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedBranchId(b.id);
                  setIsOpen(false);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isSelected ? '#EFF6FF' : 'transparent',
                  color: isSelected ? '#1D4ED8' : '#374151',
                  fontSize: '0.8125rem',
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>
                  <div>{b.name}</div>
                </div>
                {isSelected && <Check size={14} color="#2563EB" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
