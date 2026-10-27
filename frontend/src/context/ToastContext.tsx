import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastItem = { ...toast, id };

    setToasts(prev => [newToast, ...prev].slice(0, 4));

    // Auto-dismiss after 4 seconds (4000ms)
    setTimeout(() => {
      dismissToast(id);
    }, 4000);

    return id;
  }, [dismissToast]);

  const success = useCallback((message: string, title?: string) => {
    return addToast({ type: 'success', title: title || 'Success', message });
  }, [addToast]);

  const error = useCallback((message: string, title?: string) => {
    return addToast({ type: 'error', title: title || 'Error', message });
  }, [addToast]);

  const warning = useCallback((message: string, title?: string) => {
    return addToast({ type: 'warning', title: title || 'Warning', message });
  }, [addToast]);

  const info = useCallback((message: string, title?: string) => {
    return addToast({ type: 'info', title: title || 'Information', message });
  }, [addToast]);

  // Global listener for 401 unauthorized events from api.ts
  useEffect(() => {
    const handleUnauthorized = (e: Event) => {
      const customEvent = e as CustomEvent<{ message?: string }>;
      const msg = customEvent.detail?.message || 'Session expired. Please sign in again.';
      error(msg, 'Session Expired');
    };

    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth-unauthorized', handleUnauthorized);
  }, [error]);

  return (
    <ToastContext.Provider
      value={{
        toasts,
        addToast,
        dismissToast,
        success,
        error,
        warning,
        info,
      }}
    >
      {children}

      {/* Global Toast Viewport */}
      <div className="fixed bottom-6 right-4 md:right-8 z-50 flex flex-col gap-3 w-full max-w-sm pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
            let borderBg = 'bg-surface-container-high/90 border-border-subtle text-text-primary';
            let icon = 'info';
            let iconColor = 'text-primary';
            let titleColor = 'text-primary';

            if (toast.type === 'success') {
              borderBg = 'bg-status-normal/15 border-status-normal/40 text-text-primary shadow-[0_0_20px_rgba(16,185,129,0.2)]';
              icon = 'check_circle';
              iconColor = 'text-status-normal';
              titleColor = 'text-status-normal';
            } else if (toast.type === 'error') {
              borderBg = 'bg-status-critical/15 border-status-critical/50 text-text-primary shadow-[0_0_20px_rgba(244,63,94,0.25)]';
              icon = 'error';
              iconColor = 'text-status-critical';
              titleColor = 'text-status-critical';
            } else if (toast.type === 'warning') {
              borderBg = 'bg-status-warning/15 border-status-warning/40 text-text-primary shadow-[0_0_20px_rgba(245,158,11,0.2)]';
              icon = 'warning';
              iconColor = 'text-status-warning';
              titleColor = 'text-status-warning';
            }

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={`pointer-events-auto p-4 rounded-xl border backdrop-blur-xl flex items-start gap-3 ${borderBg}`}
              >
                <span className={`material-symbols-outlined text-2xl shrink-0 mt-0.5 ${iconColor}`}>
                  {icon}
                </span>

                <div className="flex-1 min-w-0 flex flex-col">
                  {toast.title && (
                    <span className={`font-label-mono font-bold tracking-widest text-[11px] uppercase mb-0.5 ${titleColor}`}>
                      {toast.title}
                    </span>
                  )}
                  <span className="font-body-md text-xs text-text-primary leading-relaxed break-words">
                    {toast.message}
                  </span>
                </div>

                <button
                  onClick={() => dismissToast(toast.id)}
                  className="text-text-secondary hover:text-text-primary transition-colors p-1 -mr-1 -mt-1 cursor-pointer"
                  aria-label="Dismiss toast"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
