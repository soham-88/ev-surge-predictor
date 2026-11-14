import React from 'react';
import { motion } from 'motion/react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon = 'inbox_customize',
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex flex-col items-center justify-center text-center p-8 md:p-12 rounded-2xl bg-surface-container-lowest/50 border border-border-subtle/60 backdrop-blur-md ${className}`}
    >
      <div className="w-16 h-16 rounded-full bg-surface-variant/30 border border-border-subtle flex items-center justify-center mb-4 text-primary/80 shadow-[0_0_20px_rgba(138,235,255,0.1)]">
        <span className="material-symbols-outlined text-3xl">{icon}</span>
      </div>

      <h3 className="font-headline-md text-lg md:text-xl font-bold text-text-primary mb-2">
        {title}
      </h3>

      {description && (
        <p className="font-body-md text-text-secondary max-w-md text-xs md:text-sm leading-relaxed mb-6">
          {description}
        </p>
      )}

      {action && <div>{action}</div>}
    </motion.div>
  );
}
