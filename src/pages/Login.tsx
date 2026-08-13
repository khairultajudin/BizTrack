import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, User } from 'lucide-react';

export const Login: React.FC = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName }
          }
        });
        if (error) throw error;
        setMessage('Registration successful! Check your email if confirmation is enabled, otherwise you can log in.');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        
        if (error) throw error;
        navigate('/');
      }
    } catch (err: any) {
      console.error('Supabase Auth Error:', err);
      const detailedError = [
        `Message: ${err.message || 'Unknown error'}`,
        err.status ? `Status: ${err.status}` : '',
        err.code ? `Code: ${err.code}` : '',
        err.hint ? `Hint: ${err.hint}` : ''
      ].filter(Boolean).join(' | ');
      setError(detailedError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="card w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex items-center justify-center">
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="9" fill="#3B82F6" />
              <polygon points="16,8 26,12.5 16,17 6,12.5" fill="white" opacity="0.95" />
              <polygon points="16,8 26,12.5 16,14.5 6,12.5" fill="white" opacity="0.3" />
              <rect x="8" y="19" width="3.5" height="6" rx="1.2" fill="white" opacity="0.85" />
              <rect x="14.25" y="16.5" width="3.5" height="8.5" rx="1.2" fill="white" />
              <rect x="20.5" y="21" width="3.5" height="4" rx="1.2" fill="white" opacity="0.85" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{isSignUp ? 'Create an Account' : 'Welcome to BizTrack'}</h1>
          <p className="text-gray-500 mt-2">{isSignUp ? 'Sign up to start managing your business' : 'Sign in to manage your business'}</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm mb-6 border border-red-100">
            {error}
          </div>
        )}
        
        {message && (
          <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm mb-6 border border-green-100">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="input-group">
              <label className="input-label">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input
                  type="text"
                  required
                  className="input w-full pl-10"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 text-gray-400" size={18} />
              <input
                type="email"
                required
                className="input w-full pl-10"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          
          <div className="input-group">
            <label className="input-label">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 text-gray-400" size={18} />
              <input
                type="password"
                required
                className="input w-full pl-10"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary w-full mt-4 h-11"
            disabled={loading}
          >
            {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <button onClick={() => setIsSignUp(false)} className="text-blue-600 font-medium hover:underline focus:outline-none">
                Sign in
              </button>
            </>
          ) : (
            <>
              Don't have an account?{' '}
              <button onClick={() => setIsSignUp(true)} className="text-blue-600 font-medium hover:underline focus:outline-none">
                Sign up
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
