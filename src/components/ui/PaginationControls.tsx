import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationControlsProps {
  hasMore: boolean;
  onNext: () => void;
  onPrev: () => void;
  isFirstPage: boolean;
  isLoading: boolean;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  hasMore,
  onNext,
  onPrev,
  isFirstPage,
  isLoading
}) => {
  return (
    <div className="flex items-center justify-between border-t border-gray-100 bg-white px-4 py-3 sm:px-6 mt-4 rounded-b-xl">
      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700">
            {isLoading ? 'Loading records...' : 'Showing results for current page'}
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={onPrev}
              disabled={isFirstPage || isLoading}
              className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium ${isFirstPage || isLoading ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <span className="sr-only">Previous</span>
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={onNext}
              disabled={!hasMore || isLoading}
              className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium ${!hasMore || isLoading ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <span className="sr-only">Next</span>
              <ChevronRight size={20} />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
};
