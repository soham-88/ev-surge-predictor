import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Base shimmering skeleton block matching Grid Pulse dark aesthetic.
 */
export function Skeleton({ className = '', ...props }: SkeletonProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-surface-container-low/70 border border-border-subtle/40 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/[0.07] before:to-transparent ${className}`}
      {...props}
    />
  );
}

/**
 * Skeleton text line with varied heights and widths.
 */
export function SkeletonText({ className = '', ...props }: SkeletonProps) {
  return (
    <div
      className={`relative overflow-hidden rounded bg-surface-container-high/60 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/[0.08] before:to-transparent h-4 ${className}`}
      {...props}
    />
  );
}

/**
 * Pre-composed Skeleton card matching a standard dashboard Tile.
 */
export function SkeletonCard({
  className = '',
  lines = 2,
  hasHeader = true,
}: {
  className?: string;
  lines?: number;
  hasHeader?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col justify-between before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/[0.05] before:to-transparent ${className}`}
    >
      {hasHeader && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-container/80" />
            <SkeletonText className="w-28 h-5" />
          </div>
          <div className="w-14 h-5 rounded bg-surface-container/60" />
        </div>
      )}
      <div className="flex flex-col gap-3 my-auto">
        <SkeletonText className="w-3/4 h-8" />
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonText key={i} className={`h-3.5 ${i === 0 ? 'w-full' : 'w-2/3'}`} />
        ))}
      </div>
      <div className="pt-4 border-t border-border-subtle/40 mt-4 flex justify-between">
        <SkeletonText className="w-20 h-3" />
        <SkeletonText className="w-16 h-3" />
      </div>
    </div>
  );
}
