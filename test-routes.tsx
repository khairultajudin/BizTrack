import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Import all pages
import { Login } from './src/pages/Login';
import { Dashboard } from './src/pages/Dashboard';
import { Onboarding } from './src/pages/Onboarding';
import { DataImports } from './src/pages/DataImports';
import { Analytics } from './src/pages/Analytics';
import { CreatorSettings } from './src/pages/CreatorSettings';
import { Students } from './src/pages/Students';
import { Classes } from './src/pages/Classes';
import { Teachers } from './src/pages/Teachers';
import { Payments } from './src/pages/Payments';
import { Expenses } from './src/pages/Expenses';
import { Reports } from './src/pages/Reports';
import { SystemHealth } from './src/pages/SystemHealth';

// Mock contexts
import { AuthContext } from './src/context/AuthContext';
import { TemplateContext } from './src/context/TemplateContext';

const mockAuthValue = {
  user: { id: 'test-user', role: 'creator' },
  businessId: 'test-biz',
  businessRole: 'creator',
  loading: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {}
};

const mockTemplateValue = {
  template: 'tuition',
  settings: { theme: 'light', sidebar_color: 'blue' },
  modules: { students: true, classes: true, teachers: true, payments: true, expenses: true, reports: true },
  updateSettings: async () => {},
  toggleModule: async () => {},
  changeTemplate: async () => {},
  t: (key: string) => key
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthContext.Provider value={mockAuthValue as any}>
    <TemplateContext.Provider value={mockTemplateValue as any}>
      <MemoryRouter>
        {children}
      </MemoryRouter>
    </TemplateContext.Provider>
  </AuthContext.Provider>
);

const routesToTest = [
  { name: 'Login', component: <Login /> },
  { name: 'Dashboard', component: <Dashboard /> },
  { name: 'Onboarding', component: <Onboarding /> },
  { name: 'DataImports', component: <DataImports /> },
  { name: 'Analytics', component: <Analytics /> },
  { name: 'CreatorSettings', component: <CreatorSettings /> },
  { name: 'Students', component: <Students /> },
  { name: 'Classes', component: <Classes /> },
  { name: 'Teachers', component: <Teachers /> },
  { name: 'Payments', component: <Payments /> },
  { name: 'Expenses', component: <Expenses /> },
  { name: 'Reports', component: <Reports /> },
  { name: 'SystemHealth', component: <SystemHealth /> },
];

async function runTests() {
  console.log('Starting Route Verification...');
  let failed = 0;

  for (const route of routesToTest) {
    try {
      renderToString(<Wrapper>{route.component}</Wrapper>);
      console.log(`✅ ${route.name} rendered successfully`);
    } catch (e: any) {
      console.error(`❌ ${route.name} failed to render:`);
      console.error(e.message);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\nValidation Failed: ${failed} route(s) crashed during initial render.`);
    process.exit(1);
  } else {
    console.log('\nValidation Passed: All routes rendered successfully without runtime exceptions.');
    process.exit(0);
  }
}

runTests();
