import { useEffect } from 'react';
import { useSpring, useTransform, motion } from 'motion/react';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}

export function AnimatedNumber({ value, decimals = 0, suffix = '', prefix = '', className = '' }: AnimatedNumberProps) {
  const springValue = useSpring(value, {
    stiffness: 100,
    damping: 30,
    mass: 1,
  });

  const displayValue = useTransform(springValue, (current) => {
    return `${prefix}${current.toFixed(decimals)}${suffix}`;
  });

  useEffect(() => {
    springValue.set(value);
  }, [value, springValue]);

  return (
    <motion.span className={className}>
      {displayValue}
    </motion.span>
  );
}
