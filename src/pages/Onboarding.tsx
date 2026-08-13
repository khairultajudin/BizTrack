import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Building2 } from 'lucide-react';

export const Onboarding: React.FC = () => {
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const { error: rpcError } = await supabase.rpc('create_business', {
        business_name: businessName
      });
      
      if (rpcError) throw rpcError;
      
      await refreshAuth();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to create business');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="card w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-500 rounded-xl mx-auto mb-4 flex items-center justify-center text-white">
            <Building2 size={24} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome!</h1>
          <p className="text-gray-500 mt-2">Let's set up your business workspace.</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm mb-6 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleCreateBusiness} className="flex flex-col gap-4">
          <div className="input-group">
            <label className="input-label">Business Name</label>
            <input
              type="text"
              required
              className="input w-full"
              placeholder="e.g. Bright Minds Tuition"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>

          <button 
            type="submit" 
            className="btn btn-primary w-full mt-4 h-11"
            disabled={loading || !businessName.trim()}
          >
            {loading ? 'Creating workspace...' : 'Get Started'}
          </button>
        </form>
      </div>
    </div>
  );
};
