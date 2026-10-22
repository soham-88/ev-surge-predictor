import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DataProvider } from './context/DataContext';
import { Layout } from './components/Layout/Layout';
import { ControlCenterPage } from './pages/ControlCenterPage';
import { ShapPage } from './pages/ShapPage';
import { SandboxPage } from './pages/SandboxPage';
import { BatchAnalysis } from './pages/BatchAnalysis';
import { VehicleTariffLab } from './pages/VehicleTariffLab';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TariffProvider } from './context/TariffContext';
import { LoginPage } from './pages/LoginPage';

function AppContent() {
  const { isAuthenticated, user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-12 h-12 rounded-full border-4 border-t-primary border-primary/20 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <DataProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </DataProvider>
  );
}

function App() {
  return (
    <TariffProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </TariffProvider>
  );
}

export default App;
