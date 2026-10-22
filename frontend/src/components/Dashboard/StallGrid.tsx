
import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { Tile } from '../ui/Tile';
import { AnimatedNumber } from '../ui/AnimatedNumber';

function AnimePulse({ colorClass }: { colorClass: string }) {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ringRef.current) return;
    const anim = animate(ringRef.current, {
      scale: [1, 2.5],
      opacity: [0.8, 0],
      easing: 'easeOutExpo',
      duration: 1500,
      loop: true,
    });
    return () => {
      anim.pause();
    };
  }, []);

  return (
    <div className="relative flex items-center justify-center w-2 h-2">
      <div className={`absolute w-full h-full rounded-full ${colorClass} opacity-80`} />
      <div ref={ringRef} className={`absolute w-full h-full rounded-full ${colorClass}`} />
    </div>
  );
}

interface Props {
  activePlugs: number;
  throttledStalls: number[];
  shedStalls: number[];
  perStallCapKw: number;
  bayStates?: Record<number, { state: 'ACTIVE' | 'THROTTLED' | 'SHED' | 'IDLE'; kwDraw: number }>;
}

export function StallGrid({ activePlugs, throttledStalls, shedStalls, perStallCapKw, bayStates }: Props) {
  const stalls = Array.from({ length: 8 }, (_, i) => i + 1);

  // Compute tallies based on bayStates if available, otherwise fallback
  const activeCount = bayStates ? Object.values(bayStates).filter(b => b.state === 'ACTIVE').length : Math.max(0, activePlugs - shedStalls.length);
  const throttledCount = bayStates ? Object.values(bayStates).filter(b => b.state === 'THROTTLED').length : throttledStalls.length;
  const shedCount = bayStates ? Object.values(bayStates).filter(b => b.state === 'SHED').length : shedStalls.length;

  return (
    <section className="flex flex-col gap-4">
      {/* Header & Tallies */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-text-secondary">ev_station</span>
          <h2 className="font-headline-md text-headline-md text-text-primary">Bay Matrix Status</h2>
        </div>
        
        {/* Dynamic Tallies */}
        <div className="flex items-center gap-4 border border-border-subtle bg-surface-container/30 px-4 py-2 rounded-lg">
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-text-secondary font-label-mono uppercase tracking-widest">Active</span>
            <span className="font-bold text-primary tabular-nums"><AnimatedNumber value={activeCount} /></span>
          </div>
          <div className="w-px h-6 bg-border-subtle"></div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-text-secondary font-label-mono uppercase tracking-widest">Throttled</span>
            <span className="font-bold text-status-warning tabular-nums"><AnimatedNumber value={throttledCount} /></span>
          </div>
          <div className="w-px h-6 bg-border-subtle"></div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-text-secondary font-label-mono uppercase tracking-widest">Shed</span>
            <span className="font-bold text-status-critical tabular-nums"><AnimatedNumber value={shedCount} /></span>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-gap-grid">
        {stalls.map((stallNum, i) => {
          let isShed = false;
          let isThrottled = false;
          let isActive = false;
          let kwDraw = 0;

          if (bayStates) {
            const bay = bayStates[stallNum];
            isShed = bay.state === 'SHED';
            isThrottled = bay.state === 'THROTTLED';
            isActive = bay.state === 'ACTIVE';
            kwDraw = bay.kwDraw;
          } else {
            isShed = shedStalls.includes(stallNum);
            isThrottled = throttledStalls.includes(stallNum);
            isActive = stallNum <= activePlugs && !isShed;
            if (isThrottled) kwDraw = perStallCapKw;
            else if (isActive) kwDraw = 25;
          }

          let statusClass = 'text-outline';
          let bgClass = 'bg-outline';
          let statusText = 'IDLE';
          let borderStyle = 'border-t-2 border-t-transparent';
          let pulseClass = '';
          let opacityClass = 'opacity-50';

          if (isShed) {
            statusClass = 'text-status-critical';
            bgClass = 'bg-status-critical';
            statusText = 'SHED';
            borderStyle = 'border border-border-subtle';
            opacityClass = 'opacity-40';
          } else if (isThrottled) {
            statusClass = 'text-status-warning';
            bgClass = 'bg-status-warning';
            statusText = 'THROTTLED';
            borderStyle = 'border border-dashed border-status-warning';
            pulseClass = 'bg-status-warning';
            opacityClass = '';
          } else if (isActive) {
            statusClass = 'text-primary';
            bgClass = 'bg-primary';
            statusText = 'ACTIVE';
            borderStyle = 'border-t-2 border-t-transparent';
            pulseClass = 'bg-primary';
            opacityClass = '';
          }

          const paddedNum = stallNum.toString().padStart(2, '0');

          return (
            <Tile
              key={stallNum}
              index={i + 1}
              className={`flex flex-col items-center justify-center gap-4 relative overflow-hidden ${borderStyle} ${opacityClass}`}
            >
              <div className="absolute top-3 left-3 flex items-center gap-2">
                {pulseClass ? (
                  <AnimePulse colorClass={pulseClass} />
                ) : (
                  <div className={`w-2 h-2 rounded-full ${bgClass}`}></div>
                )}
                <span className={`font-label-mono text-[10px] ${statusClass} tracking-widest`}>
                  {statusText}
                </span>
              </div>
              
              {isShed && (
                <div className="absolute top-3 right-3 bg-status-critical/20 text-status-critical border border-status-critical/30 px-2 py-0.5 rounded text-[10px] font-bold font-label-mono uppercase tracking-wider">
                  SHED
                </div>
              )}
              
              <div className={`mt-4 font-headline-xl text-headline-xl text-text-primary ${opacityClass === '' ? 'opacity-80' : 'opacity-50'} tabular-nums`}>
                {paddedNum}
              </div>
              
              <div className={`font-kpi-large text-kpi-large ${statusClass} tabular-nums`}>
                <AnimatedNumber value={kwDraw} decimals={1} />
                <span className={`text-sm ${isActive || isThrottled ? 'text-text-secondary' : 'text-outline/50'} ml-1`}>
                  kW
                </span>
              </div>
            </Tile>
          );
        })}
      </div>
    </section>
  );
}
