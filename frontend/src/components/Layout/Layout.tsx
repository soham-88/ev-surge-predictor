import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { HeaderKPIs } from '../Dashboard/HeaderKPIs';
import { SideNavBar } from '../Dashboard/SideNavBar';
import { useData } from '../../context/DataContext';

export function Layout() {
  const { predictData, isLoading, headerKpis, toasts, dismissToast } = useData();
  const location = useLocation();

  if (isLoading || !predictData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-text-secondary">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin border-primary" />
        <span className="font-label-mono text-label-mono tracking-widest uppercase">
          INITIALIZING GRID PULSE...
        </span>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col overflow-x-hidden selection:bg-primary/30 text-text-primary bg-background">
      {/* Subtle Premium Background */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/10 via-background to-background" />

      <div className="relative z-10 flex flex-col flex-1">
        <HeaderKPIs
        latency={headerKpis.latencyMs}
        gridFrequency={headerKpis.gridFrequencyHz}
        ambientTemp={headerKpis.ambientTempC}
      />

        <div className="flex flex-1 pt-16">
          <SideNavBar />
          <main className="flex-1 lg:ml-64 p-4 md:p-8 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 10, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(10px)' }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* Global Toasts Container */}
      <div className="fixed top-20 right-4 md:right-8 z-100 flex flex-col gap-3 w-full max-w-sm pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, scale: toast.type === 'CRITICAL' ? 0.95 : 1 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              className={`pointer-events-auto p-4 rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-3 ${
                toast.type === 'CRITICAL'
                  ? 'bg-status-critical/10 border-status-critical/50 shadow-[0_0_20px_rgba(225,29,72,0.3)] animate-pulse-fast'
                  : 'bg-status-warning/10 border-status-warning/50'
              }`}
            >
              <div className={`mt-0.5 material-symbols-outlined ${toast.type === 'CRITICAL' ? 'text-status-critical text-2xl' : 'text-status-warning'}`}>
                {toast.type === 'CRITICAL' ? 'warning' : 'info'}
              </div>
              <div className="flex-1 flex flex-col">
                <span className={`font-label-mono font-bold tracking-widest text-xs uppercase mb-1 ${
                  toast.type === 'CRITICAL' ? 'text-status-critical' : 'text-status-warning'
                }`}>
                  {toast.title}
                </span>
                <span className="font-body-sm text-text-primary">
                  {toast.message}
                </span>
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="text-text-secondary hover:text-text-primary transition-colors mt-0.5"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
