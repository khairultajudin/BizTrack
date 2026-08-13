import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchEngineProps {
  onSearch: (query: string, advancedFilters?: any) => void;
  placeholder?: string;
  enableAdvanced?: boolean;
}

/**
 * Universal Search Engine Component
 * Supports standard text search with debouncing.
 * Built to accommodate future advanced filters (Date Range, Status, Full-Text).
 */
export const SearchEngine: React.FC<SearchEngineProps> = ({ 
  onSearch, 
  placeholder = 'Search...' 
}) => {
  const [query, setQuery] = useState('');

  // Debounce search to prevent excessive DB calls
  useEffect(() => {
    const handler = setTimeout(() => {
      onSearch(query);
    }, 300);

    return () => clearTimeout(handler);
  }, [query, onSearch]);

  return (
    <div className="relative w-full md:w-64">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search size={16} className="text-gray-400" />
      </div>
      <input
        type="text"
        className="input pl-10 w-full bg-white"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button 
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
          onClick={() => setQuery('')}
        >
          <X size={16} />
        </button>
      )}
      
      {/* Future advanced filters UI can be toggled here based on enableAdvanced */}
    </div>
  );
};
