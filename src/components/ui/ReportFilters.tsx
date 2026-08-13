import React, { useState } from 'react';
import { Filter, Search } from 'lucide-react';

export interface FilterConfig {
  id: string;
  label: string;
  type: 'select' | 'date' | 'month' | 'year' | 'text';
  options?: { label: string; value: string }[];
  placeholder?: string;
  defaultValue?: string;
}

interface ReportFiltersProps {
  configs: FilterConfig[];
  onFilterChange: (filters: Record<string, string>) => void;
  storageKey?: string;
}

export const ReportFilters: React.FC<ReportFiltersProps> = ({ configs, onFilterChange, storageKey }) => {
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(`biztrack_filters_${storageKey}`);
      if (saved) return JSON.parse(saved);
    }
    
    const initial: Record<string, string> = {};
    configs.forEach(c => {
      initial[c.id] = c.defaultValue || '';
    });
    return initial;
  });

  // Call onFilterChange on mount if we loaded from storage
  React.useEffect(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(`biztrack_filters_${storageKey}`);
      if (saved) {
        onFilterChange(JSON.parse(saved));
      }
    }
  }, []);

  const handleChange = (id: string, value: string) => {
    const newFilters = { ...filters, [id]: value };
    setFilters(newFilters);
  };

  const handleApply = () => {
    if (storageKey) {
      localStorage.setItem(`biztrack_filters_${storageKey}`, JSON.stringify(filters));
    }
    onFilterChange(filters);
  };

  const handleReset = () => {
    const resetFilters: Record<string, string> = {};
    configs.forEach(c => {
      resetFilters[c.id] = c.defaultValue || '';
    });
    setFilters(resetFilters);
    if (storageKey) {
      localStorage.setItem(`biztrack_filters_${storageKey}`, JSON.stringify(resetFilters));
    }
    onFilterChange(resetFilters);
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 mb-6 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">
        <Filter size={16} />
        Filter Reports
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {configs.map((config) => (
          <div key={config.id} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{config.label}</label>
            
            {config.type === 'select' && config.options && (
              <select
                className="input py-1.5 px-3 text-sm bg-gray-50"
                value={filters[config.id]}
                onChange={(e) => handleChange(config.id, e.target.value)}
              >
                <option value="">All</option>
                {config.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}

            {(config.type === 'date' || config.type === 'month') && (
              <input
                type={config.type}
                className="input py-1.5 px-3 text-sm bg-gray-50"
                value={filters[config.id]}
                onChange={(e) => handleChange(config.id, e.target.value)}
              />
            )}

            {config.type === 'year' && (
              <input
                type="number"
                placeholder="YYYY"
                className="input py-1.5 px-3 text-sm bg-gray-50"
                value={filters[config.id]}
                onChange={(e) => handleChange(config.id, e.target.value)}
              />
            )}
            
            {config.type === 'text' && (
              <input
                type="text"
                placeholder={config.placeholder}
                className="input py-1.5 px-3 text-sm bg-gray-50"
                value={filters[config.id]}
                onChange={(e) => handleChange(config.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={handleReset} className="px-4 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
          Reset
        </button>
        <button onClick={handleApply} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2" style={{ backgroundColor: 'var(--primary)' }}>
          <Search size={14} />
          Apply Filters
        </button>
      </div>
    </div>
  );
};
