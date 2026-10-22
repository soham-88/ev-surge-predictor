import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

interface TileProps {
  children: ReactNode;
  className?: string;
  index?: number;
  style?: React.CSSProperties;
}

export function Tile({ children, className = '', index = 0, style }: TileProps) {
  const shouldReduceMotion = useReducedMotion();

  const initial = shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 };
  const animate = { opacity: 1, y: 0 };
  const transition = shouldReduceMotion 
    ? { duration: 0 } 
    : { duration: 0.6, delay: index * 0.06 };

  const hoverProps = shouldReduceMotion
    ? {}
    : { whileHover: { scale: 1.015 } };

  return (
    <motion.div
      initial={initial}
      animate={animate}
      transition={transition}
      style={style}
      {...hoverProps}
      className={`bg-glass-fill backdrop-blur-xl border border-border-subtle rounded-xl p-padding-tile relative overflow-hidden transition-colors duration-300 hover:border-primary ${className}`}
    >
      {children}
    </motion.div>
  );
}
