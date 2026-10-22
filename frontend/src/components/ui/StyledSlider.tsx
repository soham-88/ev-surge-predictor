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
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <label className="font-label-mono text-label-mono text-text-secondary">
          {label}
        </label>
        <span className="font-label-mono text-label-mono text-primary font-bold tabular-nums">
          {prefix}
          {value}
          {unit}
        </span>
      </div>
      
      {/* Container with top padding to fit the floating bubble */}
      <div className="relative pt-8 pb-2">
        {/* Floating Bubble */}
        <div
          className={`absolute top-0 -translate-x-1/2 transition-all duration-200 pointer-events-none
            ${isDragging ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
          style={{ left: `${pct}%` }}
        >
          <div className="bg-surface-container border border-border-subtle rounded px-2 py-1 text-[10px] font-label-mono text-primary font-bold shadow-[0_0_8px_rgba(34,211,238,0.3)] whitespace-nowrap">
            {prefix}{value}{unit}
          </div>
        </div>

        <input
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
            background: `linear-gradient(90deg, #22d3ee 0%, #22d3ee ${pct}%, #1a1d26 ${pct}%, #1a1d26 100%)`,
          }}
        />
      </div>
    </div>
  );
}
