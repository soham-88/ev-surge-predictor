import { motion } from 'motion/react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'Service Unavailable',
  message,
  onRetry,
  isRetrying = false,
  className = '',
}: ErrorStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex flex-col items-center justify-center text-center p-8 md:p-12 rounded-2xl bg-surface-container-lowest/70 border border-status-critical/30 backdrop-blur-xl shadow-2xl ${className}`}
    >
      <div className="w-16 h-16 rounded-full bg-status-critical/15 border border-status-critical/30 flex items-center justify-center mb-4 text-status-critical shadow-[0_0_25px_rgba(244,63,94,0.25)]">
        <span className="material-symbols-outlined text-3xl">cloud_off</span>
      </div>

      <h3 className="font-headline-md text-xl md:text-2xl font-bold text-text-primary mb-2 tracking-tight">
        {title}
      </h3>

      <p className="font-body-md text-text-secondary max-w-md mb-6 text-sm leading-relaxed">
        {message}
      </p>

      {onRetry && (
        <button
          onClick={onRetry}
          disabled={isRetrying}
          className="px-6 py-2.5 rounded-xl bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 font-label-mono text-xs uppercase tracking-widest font-bold transition-all shadow-[0_0_15px_rgba(138,235,255,0.2)] hover:shadow-[0_0_25px_rgba(138,235,255,0.4)] flex items-center gap-2.5 cursor-pointer disabled:opacity-50"
        >
          {isRetrying ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="material-symbols-outlined text-base">refresh</span>
          )}
          <span>{isRetrying ? 'RECONNECTING...' : 'RETRY CONNECTION'}</span>
        </button>
      )}
    </motion.div>
  );
}
