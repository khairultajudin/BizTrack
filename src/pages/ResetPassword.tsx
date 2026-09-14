import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);
  
  const navigate = useNavigate();

  // ─── Verify recovery session on load ───────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    // Check for error parameters in URL hash or query string
    const hash = window.location.hash.startsWith('#') ? window.location.hash.substring(1) : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const searchParams = new URLSearchParams(window.location.search);

    const errorParam = hashParams.get('error') || searchParams.get('error');
    const errorCode = hashParams.get('error_code') || searchParams.get('error_code');
    const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');

    if (errorParam || errorCode || errorDesc) {
      if (isMounted) {
        setSessionError('Your password reset link is invalid or has expired. Please request a new password reset link.');
        setIsValidSession(false);
        setCheckingSession(false);
      }
      return;
    }

    // Listen for auth state change event
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      
      if (event === 'PASSWORD_RECOVERY' || (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION'))) {
        setIsValidSession(true);
        setSessionError(null);
        setCheckingSession(false);
      }
    });

    // Also check current session directly
    supabase.auth.getSession().then(({ data: { session }, error: getSessionError }) => {
      if (!isMounted) return;
      if (getSessionError || !session) {
        // If hash contains type=recovery or access_token, give Supabase a brief moment to process the hash
        const hasRecoveryToken = hash.includes('type=recovery') || hash.includes('access_token=');
        if (!hasRecoveryToken) {
          setSessionError('Your password reset link is invalid or has expired. Please request a new password reset link.');
          setIsValidSession(false);
          setCheckingSession(false);
        } else {
          // Allow timeout for hash parsing
          setTimeout(async () => {
            if (!isMounted) return;
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession) {
              setIsValidSession(true);
              setSessionError(null);
            } else {
              setSessionError('Your password reset link is invalid or has expired. Please request a new password reset link.');
              setIsValidSession(false);
            }
            setCheckingSession(false);
          }, 1000);
        }
      } else {
        setIsValidSession(true);
        setSessionError(null);
        setCheckingSession(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ─── Automatic redirect countdown on success ──────────────────────────────
  useEffect(() => {
    if (!success) return;

    if (countdown <= 0) {
      navigate('/login');
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [success, countdown, navigate]);

  // ─── Form submission ───────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        const errorMsg = updateError.message?.toLowerCase() || '';
        if (
          errorMsg.includes('rate limit') || 
          updateError.status === 429 || 
          (updateError as any).code === 'over_email_send_rate_limit'
        ) {
          setError('Too many reset requests were made. Please wait a while before requesting another reset email.');
        } else if (errorMsg.includes('session') || errorMsg.includes('expired') || errorMsg.includes('invalid')) {
          setError('Your recovery session has expired. Please request a new password reset link.');
        } else {
          setError(updateError.message || 'Failed to update password. Please try again.');
        }
        return;
      }

      setSuccess(true);
      // Clean up session if needed
      await supabase.auth.signOut().catch(() => {});
    } catch (err: any) {
      console.error('Password reset update error:', err);
      const msg = err?.message?.toLowerCase() || '';
      if (msg.includes('rate limit') || err?.status === 429) {
        setError('Too many reset requests were made. Please wait a while before requesting another reset email.');
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
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
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
          <p className="text-gray-500 mt-2 text-sm">
            {success ? 'Your password has been successfully updated.' : 'Enter your new password below.'}
          </p>
        </div>

        {checkingSession ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-gray-500">
            <RefreshCw className="animate-spin text-blue-600" size={32} />
            <p className="text-sm">Verifying reset session...</p>
          </div>
        ) : sessionError || !isValidSession ? (
          <div className="flex flex-col gap-6">
            <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm border border-red-200 flex items-start gap-3">
              <AlertCircle size={20} className="shrink-0 mt-0.5 text-red-600" />
              <div>
                <p className="font-semibold text-red-800 mb-1">Invalid or Expired Link</p>
                <p>{sessionError || 'Your password reset link is invalid or has expired. Please request a new password reset link.'}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="btn btn-primary w-full h-11"
              >
                Request New Reset Link
              </button>

              <Link
                to="/login"
                className="btn border border-gray-300 text-gray-700 hover:bg-gray-100 w-full text-center"
              >
                Back to Sign In
              </Link>
            </div>
          </div>
        ) : success ? (
          <div className="flex flex-col gap-6">
            <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm border border-green-200 flex items-start gap-3">
              <CheckCircle2 size={20} className="shrink-0 mt-0.5 text-green-600" />
              <div>
                <p className="font-semibold text-green-800 mb-1">Password updated successfully.</p>
                <p>You can now sign in with your new password. Redirecting to login in {countdown}s...</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/login')}
              className="btn btn-primary w-full h-11"
            >
              Continue to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-100 flex items-start gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="input-group">
              <label className="input-label">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="input w-full pl-10 pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Must be at least 6 characters</p>
            </div>

            <div className="input-group">
              <label className="input-label">Confirm New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  className="input w-full pl-10 pr-10"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary w-full mt-2 h-11"
              disabled={loading}
            >
              {loading ? 'Updating Password...' : 'Update Password'}
            </button>

            <div className="mt-4 text-center">
              <Link 
                to="/login" 
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline focus:outline-none"
              >
                Back to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
