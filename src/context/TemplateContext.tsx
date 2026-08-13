import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface CreatorSettings {
  business_template: string;
  enabled_modules: {
    students: boolean;
    classes: boolean;
    teachers: boolean;
    payments: boolean;
    expenses: boolean;
    reports: boolean;
    inventory: boolean;
    attendance: boolean;
    booking: boolean;
    crm: boolean;
    payroll: boolean;
    pos: boolean;
  };
}

export interface BusinessSettings {
  default_currency: string;
  brand_color: string;
  business_logo: string | null;
}

const DEFAULT_MODULES = {
  students: true, classes: true, teachers: true, payments: true, expenses: true, reports: true,
  inventory: false, attendance: false, booking: false, crm: false, payroll: false, pos: false
};

interface TemplateContextType {
  template: string;
  modules: CreatorSettings['enabled_modules'];
  settings: BusinessSettings;
  t: (key: string) => string;
  loading: boolean;
}

export const TemplateContext = createContext<TemplateContextType>({
  template: 'tuition',
  modules: DEFAULT_MODULES,
  settings: { default_currency: 'MYR', brand_color: '#3B82F6', business_logo: null },
  t: (key) => key,
  loading: true
});

const DICTIONARY: Record<string, Record<string, string>> = {
  tuition: {
    students: 'Students',
    classes: 'Classes',
    teachers: 'Teachers',
    dashboard: 'Dashboard',
    payments: 'Payments',
    expenses: 'Expenses',
    reports: 'Reports'
  },
  gym: {
    students: 'Members',
    classes: 'Sessions',
    teachers: 'Trainers',
    dashboard: 'Dashboard',
    payments: 'Payments',
    expenses: 'Expenses',
    reports: 'Reports'
  },
  workshop: {
    students: 'Clients',
    classes: 'Services',
    teachers: 'Mechanics',
    dashboard: 'Dashboard',
    payments: 'Payments',
    expenses: 'Expenses',
    reports: 'Reports'
  }
};

export const TemplateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { businessId } = useAuth();
  const [template, setTemplate] = useState('tuition');
  const [modules, setModules] = useState(DEFAULT_MODULES);
  const [settings, setSettings] = useState<BusinessSettings>({ default_currency: 'MYR', brand_color: '#3B82F6', business_logo: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    const fetchSettings = async () => {
      try {
        const [creatorRes, settingsRes] = await Promise.all([
          supabase.from('creator_settings').select('*').eq('business_id', businessId).single(),
          supabase.from('business_settings').select('*').eq('business_id', businessId).single()
        ]);

        if (creatorRes.data) {
          setTemplate(creatorRes.data.business_template);
          setModules(creatorRes.data.enabled_modules || DEFAULT_MODULES);
        }
        if (settingsRes.data) {
          setSettings({
            default_currency: settingsRes.data.default_currency,
            brand_color: settingsRes.data.brand_color,
            business_logo: settingsRes.data.business_logo
          });
          // Update CSS variable for brand color
          document.documentElement.style.setProperty('--primary', settingsRes.data.brand_color);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [businessId]);

  const t = (key: string): string => {
    return DICTIONARY[template]?.[key] || DICTIONARY['tuition'][key] || key;
  };

  return (
    <TemplateContext.Provider value={{ template, modules, settings, t, loading }}>
      {children}
    </TemplateContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTemplate = () => useContext(TemplateContext);
