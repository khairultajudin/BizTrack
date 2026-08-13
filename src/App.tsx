import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TemplateProvider, useTemplate } from './context/TemplateContext';
import { AppLayout } from './components/layout/AppLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './pages/Onboarding';
import { DataImports } from './pages/DataImports';
import { Analytics } from './pages/Analytics';
import { CreatorSettings } from './pages/CreatorSettings';
import { Students } from './pages/Students';
import { Classes } from './pages/Classes';
import { Teachers } from './pages/Teachers';
import { Payments } from './pages/Payments';
import { Expenses } from './pages/Expenses';
import { Reports } from './pages/Reports';
import { SystemHealth } from './pages/SystemHealth';
import { MyProfile } from './pages/MyProfile';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, businessId } = useAuth();
  
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!businessId) return <Navigate to="/onboarding" replace />;
  
  return <>{children}</>;
};

const OnboardingRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, businessId } = useAuth();
  
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (businessId) return <Navigate to="/" replace />;
  
  return <>{children}</>;
};

const ModuleRoute = ({ moduleName, children }: { moduleName: string; children: React.ReactNode }) => {
  const { modules } = useTemplate();
  // @ts-ignore - dynamic key
  if (!modules[moduleName]) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TemplateProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route 
              path="/onboarding" 
              element={
                <OnboardingRoute>
                  <Onboarding />
                </OnboardingRoute>
              } 
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/settings" element={<CreatorSettings />} />
                      <Route path="/health" element={<SystemHealth />} />
                      <Route path="/profile" element={<MyProfile />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/data-imports" element={<DataImports />} />
                      <Route path="/students" element={<ModuleRoute moduleName="students"><Students /></ModuleRoute>} />
                      <Route path="/classes" element={<ModuleRoute moduleName="classes"><Classes /></ModuleRoute>} />
                      <Route path="/teachers" element={<ModuleRoute moduleName="teachers"><Teachers /></ModuleRoute>} />
                      <Route path="/payments" element={<ModuleRoute moduleName="payments"><Payments /></ModuleRoute>} />
                      <Route path="/expenses" element={<ModuleRoute moduleName="expenses"><Expenses /></ModuleRoute>} />
                      <Route path="/reports" element={<ModuleRoute moduleName="reports"><Reports /></ModuleRoute>} />
                    </Routes>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </TemplateProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
