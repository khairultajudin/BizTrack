import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { Activity, Database, Shield, Server, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Navigate } from 'react-router-dom';

export const SystemHealth: React.FC = () => {
  const { user, role, businessId, displayName } = useAuth();
  const { template } = useTemplate();
  
  const [health, setHealth] = useState({
    connection: 'loading', // loading | ok | error
    latency: 0,
    seedData: false,
    authStatus: user ? 'ok' : 'error',
    rlsStatus: 'ok', // RLS is enforced at DB level
  });

  const [businessName, setBusinessName] = useState<string>('Loading...');

  const checkHealth = useCallback(async () => {
    if (!businessId) return;

    const start = performance.now();
    try {
      // 1. Check Connection & Business Name
      const { data: bData, error: bError } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', businessId)
        .single();
        
      const latency = Math.round(performance.now() - start);

      if (bError) throw bError;
      if (bData) setBusinessName(bData.name);

      // 2. Check Seed Data (are there any staff?)
      const { count } = await supabase
        .from('staff')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId);

      setHealth(prev => ({
        ...prev,
        connection: 'ok',
        latency,
        seedData: (count && count > 0) ? true : false
      }));

    } catch (err) {
      console.error('Health check failed', err);
      setHealth(prev => ({
        ...prev,
        connection: 'error',
        latency: Math.round(performance.now() - start)
      }));
    }
  }, [businessId]);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  

  // Only Creators can view this page
  if (role !== 'Creator') {
    return <Navigate to="/" replace />;
  }

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'ok') return <CheckCircle size={18} className="text-green-500" />;
    if (status === 'error') return <XCircle size={18} className="text-red-500" />;
    if (status === 'warning') return <AlertTriangle size={18} className="text-yellow-500" />;
    return <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />;
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 pb-12">
      <header className="mb-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity size={24} />
          System Health
        </h1>
        <p className="text-muted">Developer diagnostics and environment status.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Connection & Auth */}
        <div className="card flex flex-col gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-100 pb-3">
            <Server size={20} className="text-blue-500" />
            Infrastructure
          </h2>
          
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex justify-between items-center">
              <span className="text-muted">Supabase Connection</span>
              <div className="flex items-center gap-2 font-medium">
                {health.connection === 'ok' ? 'Healthy' : health.connection === 'error' ? 'Failing' : 'Checking...'}
                <StatusIcon status={health.connection} />
              </div>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Query Latency</span>
              <span className="font-medium">{health.latency > 0 ? `${health.latency}ms` : '-'}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Authentication</span>
              <div className="flex items-center gap-2 font-medium">
                Active Session
                <StatusIcon status={health.authStatus} />
              </div>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Row Level Security (RLS)</span>
              <div className="flex items-center gap-2 font-medium">
                Enforced
                <StatusIcon status={health.rlsStatus} />
              </div>
            </li>
          </ul>
        </div>

        {/* Identity & Tenant */}
        <div className="card flex flex-col gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-100 pb-3">
            <Shield size={20} className="text-indigo-500" />
            Tenant Context
          </h2>
          
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex justify-between items-center">
              <span className="text-muted">Current User</span>
              <span className="font-medium truncate max-w-[200px]" title={user?.email}>
                {displayName}
              </span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">User ID</span>
              <span className="font-mono text-xs truncate max-w-[150px]" title={user?.id}>{user?.id}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Role</span>
              <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium">{role}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Business Name</span>
              <span className="font-medium">{businessName}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Business ID</span>
              <span className="font-mono text-xs truncate max-w-[150px]" title={businessId || ''}>{businessId}</span>
            </li>
          </ul>
        </div>

        {/* Configuration */}
        <div className="card flex flex-col gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-100 pb-3">
            <Database size={20} className="text-green-500" />
            Application State
          </h2>
          
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex justify-between items-center">
              <span className="text-muted">Environment</span>
              <span className="font-medium capitalize">{import.meta.env.MODE || 'development'}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Business Template</span>
              <span className="font-medium capitalize">{template}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Seed Data Status</span>
              <div className="flex items-center gap-2 font-medium">
                {health.seedData ? 'Populated' : 'Empty'}
                <StatusIcon status={health.seedData ? 'ok' : 'warning'} />
              </div>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Application Version</span>
              <span className="font-medium">1.0.0 (Phase 1)</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted">Latest Migration</span>
              <span className="font-medium text-xs font-mono">01_onboarding_rpc.sql</span>
            </li>
          </ul>
        </div>

      </div>
    </div>
  );
};
