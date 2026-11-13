import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DataProvider } from './context/DataContext';
import { Layout } from './components/Layout/Layout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TariffProvider } from './context/TariffContext';
import { ToastProvider } from './context/ToastContext';
import { SkeletonCard, SkeletonText } from './components/ui/Skeleton';

const ControlCenterPage = lazy(() =>
  import('./pages/ControlCenterPage').then(m => ({ default: m.ControlCenterPage }))
);
const ShapPage = lazy(() =>
  import('./pages/ShapPage').then(m => ({ default: m.ShapPage }))
);
const SandboxPage = lazy(() =>
  import('./pages/SandboxPage').then(m => ({ default: m.SandboxPage }))
);
const BatchAnalysis = lazy(() =>
  import('./pages/BatchAnalysis').then(m => ({ default: m.BatchAnalysis }))
);
const VehicleTariffLab = lazy(() =>
  import('./pages/VehicleTariffLab').then(m => ({ default: m.VehicleTariffLab }))
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then(m => ({ default: m.LoginPage }))
);

function RouteFallback() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page content">
      <div className="flex justify-between items-center mb-6">
        <SkeletonText className="w-56 h-9" />
        <SkeletonText className="w-32 h-9" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8">
          <SkeletonCard className="min-h-[360px]" />
        </div>
        <div className="md:col-span-4">
          <SkeletonCard className="min-h-[360px]" />
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Loading authentication">
        <div className="w-12 h-12 rounded-full border-4 border-t-primary border-primary/20 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <DataProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<ControlCenterPage />} />
              <Route path="shap" element={<ShapPage />} />
              {user?.role === 'Operator' && (
                <Route path="sandbox" element={<SandboxPage />} />
              )}
              <Route path="batch" element={<BatchAnalysis />} />
              <Route path="tariff-lab" element={<VehicleTariffLab />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </DataProvider>
  );
}

function App() {
  return (
    <TariffProvider>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </TariffProvider>
  );
}

export default App;
