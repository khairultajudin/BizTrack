import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { Save, Settings2, Palette } from 'lucide-react';

export const CreatorSettings: React.FC = () => {
  const { businessId, role } = useAuth();
  const { template, modules, settings } = useTemplate();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Local state for forms
  const [formTemplate, setFormTemplate] = useState(template);
  const [formCurrency, setFormCurrency] = useState(settings.default_currency);
  const [formColor, setFormColor] = useState(settings.brand_color);
  const [formModules, setFormModules] = useState(modules);

  useEffect(() => {
    setFormTemplate(template);
    setFormModules(modules);
    setFormCurrency(settings.default_currency);
    setFormColor(settings.brand_color);
  }, [template, modules, settings]);

  if (role !== 'Creator') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted">You do not have permission to view Creator Settings.</p>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);

    try {
      // 1. Update business_settings
      await supabase
        .from('business_settings')
        .update({
          default_currency: formCurrency,
          brand_color: formColor,
        })
        .eq('business_id', businessId);

      // 2. Update creator_settings
      await supabase
        .from('creator_settings')
        .update({
          business_template: formTemplate,
          enabled_modules: formModules,
        })
        .eq('business_id', businessId);

      // Force page reload to re-fetch all contexts cleanly (safest way to apply massive UI changes)
      window.location.reload();
      
    } catch (error) {
      console.error('Failed to save settings', error);
      alert('Failed to save settings.');
    } finally {
      setLoading(false);
    }
  };

  const toggleModule = (key: keyof typeof modules) => {
    setFormModules(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings2 size={24} />
            Creator Settings
          </h1>
          <p className="text-muted">Configure your business template, branding, and active modules.</p>
        </div>
        <button onClick={handleSave} disabled={loading} className="btn btn-primary">
          <Save size={18} />
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </header>

      {success && (
        <div className="bg-green-50 text-green-600 p-4 rounded-md border border-green-100 font-medium">
          Settings saved successfully! The interface has been updated.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Core Settings */}
        <div className="card flex flex-col gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-100 pb-3">
            <Palette size={20} className="text-blue-500" />
            Core Configuration
          </h2>
          
          <div className="input-group">
            <label className="input-label">Business Template</label>
            <select 
              className="input bg-white" 
              value={formTemplate} 
              onChange={e => setFormTemplate(e.target.value)}
            >
              <option value="tuition">Tuition Centre / Academy</option>
              <option value="gym">Gym / Fitness Center</option>
              <option value="workshop">Service / Workshop</option>
            </select>
            <span className="text-xs text-muted mt-1">Changes the UI terminology (e.g. Students vs Members).</span>
          </div>

          <div className="input-group">
            <label className="input-label">Default Currency</label>
            <select 
              className="input bg-white"
              value={formCurrency}
              onChange={e => setFormCurrency(e.target.value)}
            >
              <option value="MYR">MYR (Malaysian Ringgit)</option>
              <option value="USD">USD (US Dollar)</option>
              <option value="EUR">EUR (Euro)</option>
              <option value="GBP">GBP (British Pound)</option>
            </select>
          </div>

          <div className="input-group">
            <label className="input-label">Brand Color</label>
            <div className="flex items-center gap-3">
              <input 
                type="color" 
                value={formColor} 
                onChange={e => setFormColor(e.target.value)}
                className="w-10 h-10 rounded border-0 cursor-pointer p-0"
              />
              <span className="font-medium">{formColor}</span>
            </div>
            <span className="text-xs text-muted mt-1">Primary color for buttons and highlights.</span>
          </div>
        </div>

        {/* Module Toggles */}
        <div className="card flex flex-col gap-4">
          <h2 className="font-semibold text-lg border-b border-gray-100 pb-3">
            Enable Modules
          </h2>
          <p className="text-sm text-muted mb-2">Turn features on or off. Disabled modules are completely hidden from the application.</p>
          
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(formModules) as Array<keyof typeof modules>).map((mod) => (
              <label key={mod} className="flex items-center gap-3 cursor-pointer p-2 rounded-md hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                <input 
                  type="checkbox" 
                  checked={formModules[mod]}
                  onChange={() => toggleModule(mod)}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="capitalize font-medium text-sm text-gray-700">{mod}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Developer Tools */}
      <div className="card flex flex-col gap-4 mt-2 border-l-4 border-l-purple-500">
        <h2 className="font-semibold text-lg flex items-center gap-2 pb-2">
          Developer Tools
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">System Health & Diagnostics</p>
            <p className="text-sm text-muted">View developer diagnostics, connection status, and infrastructure details.</p>
          </div>
          <a href="/health" className="btn btn-ghost text-purple-600 hover:bg-purple-50">
            View System Health
          </a>
        </div>
      </div>
    </div>
  );
};
