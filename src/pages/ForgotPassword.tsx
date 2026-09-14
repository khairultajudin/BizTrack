import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';

const getResetPasswordRedirectUrl = () => {
  const customUrl = import.meta.env?.VITE_APP_URL || import.meta.env?.VITE_SITE_URL;
  if (customUrl) {
    const formattedUrl = customUrl.startsWith('http://') || customUrl.startsWith('https://') 
      ? customUrl 
      : `https://${customUrl}`;
    const cleanUrl = formattedUrl.endsWith('/') ? formattedUrl.slice(0, -1) : formattedUrl;
    return `${cleanUrl}/reset-password`;
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://biz-track-eight.vercel.app';
  const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return `${cleanOrigin}/reset-password`;
};

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const redirectTo = getResetPasswordRedirectUrl();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) {
        const errorMsg = resetError.message?.toLowerCase() || '';
        if (
          errorMsg.includes('rate limit') || 
          resetError.status === 429 || 
          (resetError as any).code === 'over_email_send_rate_limit'
        ) {
          setError('Too many reset requests were made. Please wait a while before requesting another reset email.');
          return;
        }

        // For generic errors, do not reveal user existence; log to console for debugging
        console.error('Password reset request error:', resetError);
      }

      // Security requirement: Always show generic success message
      setSubmitted(true);
    } catch (err: any) {
      console.error('Unexpected error during password reset:', err);
      const msg = err?.message?.toLowerCase() || '';
      if (msg.includes('rate limit') || err?.status === 429) {
        setError('Too many reset requests were made. Please wait a while before requesting another reset email.');
      } else {
        setError('An unexpected error occurred. Please check your network connection and try again.');
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
          <h1 className="text-2xl font-bold text-gray-900">Forgot your password?</h1>
          <p className="text-gray-500 mt-2 text-sm">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm mb-6 border border-red-100 flex items-start gap-2">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {submitted ? (
          <div className="flex flex-col gap-6">
            <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm border border-green-200 flex items-start gap-3">
              <CheckCircle2 size={20} className="shrink-0 mt-0.5 text-green-600" />
              <div>
                <p className="font-semibold text-green-800 mb-1">Check your email</p>
                <p>If an account exists for this email address, you'll receive a password reset link.</p>
              </div>
            </div>

            <p className="text-xs text-gray-500 text-center">
              Didn't receive an email? Check your spam folder or wait a few minutes before trying again.
            </p>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setError(null);
                }}
                className="btn border border-gray-300 text-gray-700 hover:bg-gray-100 w-full"
              >
                Send another link
              </button>

              <button
                type="button"
                onClick={() => navigate('/login')}
                className="btn btn-primary w-full"
              >
                Back to Sign In
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                  disabled={loading}
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary w-full mt-2 h-11"
              disabled={loading}
            >
              {loading ? 'Sending Reset Link...' : 'Send Reset Link'}
            </button>

            <div className="mt-4 text-center">
              <Link 
                to="/login" 
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium hover:underline focus:outline-none"
              >
                <ArrowLeft size={16} />
                Back to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
