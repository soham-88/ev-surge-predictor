import { useState } from 'react';

interface StyledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  prefix?: string;
  onChange: (v: number) => void;
}

export function StyledSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  prefix = '',
  onChange,
}: StyledSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const inputId = `slider-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const minDisplay = min === 0 ? `0${unit}` : `${prefix}${min}${unit}`;
  const maxDisplay = `${prefix}${max}${unit}`;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Top Label & Current Value */}
      <div className="flex justify-between items-center">
        <label htmlFor={inputId} className="font-label-mono text-label-mono text-text-secondary cursor-pointer select-none">
          {label}
        </label>
        <span className="font-label-mono text-label-mono text-primary font-bold tabular-nums">
          {prefix}{value}{unit}
        </span>
      </div>

      {/* Slider Hit-Area & Track Wrapper */}
      <div className="relative pt-4 pb-0 flex flex-col justify-center">
        {/* Floating Tooltip Bubble */}
        <div
          className={`absolute top-0 -translate-x-1/2 transition-all duration-150 pointer-events-none z-20
            ${isDragging ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-1 scale-95'}`}
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        >
          <div className="bg-surface-container-high border border-border-subtle rounded px-2 py-0.5 text-[10px] font-label-mono text-primary font-bold shadow-md whitespace-nowrap">
            {prefix}{value}{unit}
          </div>
        </div>

        {/* Native Range Input */}
        <input
          id={inputId}
          aria-label={`${label}: ${prefix}${value}${unit}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          className="custom-range-slider"
          style={{
            ['--slider-pct' as any]: `${pct}%`,
          }}
        />

        {/* Min & Max Labels Below Track Ends */}
        <div className="flex justify-between items-center text-[11px] font-label-mono text-text-secondary px-0.5 mt-0.5 select-none" aria-hidden="true">
          <span>{minDisplay}</span>
          <span>{maxDisplay}</span>
        </div>
      </div>
    </div>
  );
}
