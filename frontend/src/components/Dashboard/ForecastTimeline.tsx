import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useEffect, useState, useRef } from 'react';
import { animate } from 'animejs';
import type { TimelinePoint } from '../../types/telemetry';
import { Tile } from '../ui/Tile';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { useData } from '../../context/DataContext';

interface Props {
  data: TimelinePoint[];
  capacityPct: number;
  surgeStatus: string;
  tariffMultiplier: number;
  predictedLoadKw: number;
  transformerCapacityKw: number;
  recommendedActions: {
    throttle_active: boolean;
    per_stall_cap_kw: number;
    shed_stalls: number[];
  };
  recentEvents: Array<{ timestamp: string; status: 'CRITICAL' | 'WARNING'; multiplier: number }>;
  isSimulated?: boolean;
  isReport?: boolean;
  bayMatrixSection?: React.ReactNode;
}

export function ForecastTimeline({
  data,
  capacityPct,
  surgeStatus,
  tariffMultiplier,
  transformerCapacityKw,
  recommendedActions,
  recentEvents,
  isSimulated = false,
  isReport = false,
  bayMatrixSection,
}: Props) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [timeRange, setTimeRange] = useState<6 | 12 | 24>(24);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { settings } = useData();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  let recentData = data.slice();
  if (!showForecast) {
    recentData = recentData.slice(0, Math.max(0, recentData.length - 2));
  }
  recentData = recentData.slice(Math.max(0, recentData.length - timeRange - (showForecast ? 2 : 0)));
  const splitIndex = showForecast ? Math.max(0, recentData.length - 2) : -1;

  const chartData = recentData.map((d, i) => {
    if (!showForecast) {
      return { ...d, historical_kw: d.simulated_kw, forecast_kw: null };
    }
    if (i < splitIndex) {
      return { ...d, historical_kw: d.simulated_kw, forecast_kw: null };
    } else if (i === splitIndex) {
      return { ...d, historical_kw: d.simulated_kw, forecast_kw: d.simulated_kw };
    } else {
      return { ...d, historical_kw: null, forecast_kw: d.simulated_kw };
    }
  });

  const handleExportCSV = () => {
    setIsDropdownOpen(false);
    const headers = ['Timestamp', 'kW', 'Type', 'Source'];
    const sourceStr = isSimulated ? 'Simulated' : 'Live';
    const rows = chartData.map(d => {
      const type = d.historical_kw !== null ? 'Actual' : 'Forecast';
      const kw = d.historical_kw !== null ? d.historical_kw : d.forecast_kw;
      // Ensure strict ISO 8601 string (UTC)
      const isoTimestamp = new Date(d.timestamp).toISOString();
      return [isoTimestamp, kw, type, sourceStr].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const modeStr = isSimulated ? 'simulated' : 'live';
    link.setAttribute('download', `load_timeline_${modeStr}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    const path = document.querySelector('.forecast-line path') as SVGPathElement;
    if (path) {
      const length = path.getTotalLength();
      
      animate(path, {
        strokeDashoffset: [length, 0],
        easing: 'easeOutQuad',
        duration: 800,
        onComplete: () => {
          path.style.strokeDasharray = '5 5';
        }
      });
    }
  }, [data]);

  return (
    <>
      {/* ═══ Hero Chart Tile (8-col) ═══ */}
      <Tile index={0} className={`${isReport ? 'col-span-8' : 'md:col-span-8'} flex flex-col min-h-100 pb-16`}>
        {/* Ambient Glow Background */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none"></div>
        
        {/* Header row */}
        <div className="flex justify-between items-start mb-6 z-20 relative">
          <div>
            <h3 className="font-headline-md text-headline-md text-text-primary">24-Hour Load Timeline</h3>
            <div className="font-label-mono text-label-mono text-text-secondary mt-2 flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--tw-shadow-color)] shadow-primary"></span> 
                Actual
              </span>
              <span 
                className={`flex items-center gap-1.5 cursor-pointer select-none transition-all hover:text-text-primary ${showForecast ? 'opacity-100' : 'opacity-40 grayscale'}`}
                onClick={() => setShowForecast(!showForecast)}
                title={showForecast ? "Hide Forecast" : "Show Forecast"}
              >
                <span className="w-2 h-2 rounded-full border border-secondary border-dashed"></span> 
                Forecast (2h)
                {isSimulated && (
                  <span className="ml-1 bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-widest leading-none">
                    SIMULATED
                  </span>
                )}
              </span>
            </div>
          </div>
          
          <div className="relative" ref={dropdownRef}>
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="p-2 border border-border-subtle rounded-lg hover:bg-surface-variant transition-colors text-text-secondary cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">more_horiz</span>
            </button>
            
            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-surface border border-border-subtle rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col py-1">
                <button 
                  onClick={handleExportCSV}
                  className="px-4 py-2 text-left text-sm text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  Export as CSV
                </button>
                <div className="border-t border-border-subtle my-1"></div>
                <div className="px-4 py-2 text-xs font-label-mono text-text-secondary opacity-70">
                  Time Range
                </div>
                <div className="flex gap-2 px-4 pb-2">
                  {[6, 12, 24].map(hours => (
                    <button
                      key={hours}
                      onClick={() => { setTimeRange(hours as 6 | 12 | 24); setIsDropdownOpen(false); }}
                      className={`flex-1 py-1 text-xs font-label-mono rounded transition-colors cursor-pointer ${timeRange === hours ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-surface-variant text-text-secondary hover:bg-surface hover:text-primary border border-transparent'}`}
                    >
                      {hours}h
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 w-full relative z-10 mt-4" style={{ minHeight: '280px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="cyanFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              
              <XAxis
                dataKey="timestamp"
                stroke="rgba(255,255,255,0.15)"
                tick={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontFamily: 'var(--font-label-mono)' }}
                tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                axisLine={false}
                tickLine={false}
              />
              
              <YAxis
                stroke="rgba(255,255,255,0.15)"
                tick={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontFamily: 'var(--font-label-mono)' }}
                axisLine={false}
                tickLine={false}
                label={{
                  value: 'kW',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--color-text-secondary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-label-mono)',
                }}
              />
              
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const activePayload = payload.find(p => p.value !== null);
                    if (!activePayload) return null;
                    return (
                      <div className="bg-surface/80 backdrop-blur-xl border border-border p-3 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                        <p className="text-text-secondary text-xs mb-1">
                          {label ? new Date(label as string | number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </p>
                        <p className="text-primary font-bold font-label-mono text-lg">
                          {activePayload.value} kW
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="historical_kw"
                stroke="var(--color-primary)"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#cyanFill)"
                animationDuration={1500}
                animationEasing="ease-out"
                activeDot={{ r: 6, stroke: 'var(--color-primary)', strokeWidth: 2, fill: 'var(--color-background)' }}
              />
              {showForecast && (
                <Line
                  type="monotone"
                  dataKey="forecast_kw"
                  stroke="var(--color-secondary)"
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  dot={{ r: 6, stroke: 'var(--color-secondary)', strokeWidth: 2, fill: 'var(--color-background)' }}
                  activeDot={{ r: 8, stroke: 'var(--color-secondary)', strokeWidth: 2, fill: 'var(--color-background)' }}
                  isAnimationActive={false}
                  className="forecast-line"
                />
              )}
              {/* Reference line for capacity */}
              <ReferenceLine
                y={transformerCapacityKw}
                stroke="var(--color-error)"
                strokeDasharray="4 4"
                opacity={0.8}
              >
              </ReferenceLine>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Tile>

      {/* ═══ Utility KPI Cards (4-col each) ═══ */}

      {/* Capacity Utilization */}
      <Tile index={1} className={`${isReport ? 'col-span-4' : 'md:col-span-4'} flex flex-col items-center justify-center min-h-100`}>
        <h3 className="font-headline-md text-headline-md text-text-primary absolute top-6 left-6">
          Capacity Utilization
        </h3>
        
        {/* Radial Gauge SVG */}
        <div className="relative w-48 h-48 mt-8 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" fill="none" r="40" stroke="rgba(255,255,255,0.05)" strokeWidth="8"></circle>
            <circle 
              cx="50" 
              cy="50" 
              fill="none" 
              r="40" 
              stroke="url(#gaugeGrad)" 
              strokeDasharray="251.2" 
              strokeDashoffset={251.2 - (251.2 * (Math.min(capacityPct, 100) / 100))} 
              strokeLinecap="round" 
              strokeWidth="8"
              style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
            ></circle>
            <defs>
              <linearGradient id="gaugeGrad" x1="0%" x2="100%" y1="0%" y2="100%">
                <stop offset="0%" stopColor="var(--color-status-normal)"></stop>
                <stop offset="100%" stopColor="var(--color-status-warning)"></stop>
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="font-kpi-large text-kpi-large text-text-primary tabular-nums">
              <AnimatedNumber value={capacityPct} decimals={1} suffix="%" />
            </span>
            <span className="font-label-mono text-label-mono text-text-secondary mt-1 flex items-center gap-1">
              of {transformerCapacityKw}kW
            </span>
            {capacityPct > 100 && (
              <span className="font-label-mono text-[10px] text-status-critical mt-1 font-bold animate-pulse">
                OVER CAPACITY
              </span>
            )}
          </div>
        </div>
      </Tile>

      <Tile 
        index={2} 
        className={`surge-glow-card ${isReport ? 'col-span-6' : 'md:col-span-4'} flex flex-col justify-between min-h-50 border-t-2 ${surgeStatus === 'CRITICAL' ? 'border-t-status-critical shadow-[0_0_30px_-10px_rgba(244,63,94,0.15)] shake' : surgeStatus === 'WARNING' ? 'border-t-status-warning shadow-[0_0_30px_-10px_rgba(245,158,11,0.15)]' : 'border-t-transparent'}`}
        style={{ 
          '--pulse-duration': capacityPct >= settings.criticalThresholdPct ? '0.8s' : capacityPct >= settings.warningThresholdPct ? '1.5s' : '2.5s',
          '--glow-color': capacityPct >= settings.criticalThresholdPct ? 'rgba(244, 63, 94, 0.25)' : capacityPct >= settings.warningThresholdPct ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.1)'
        } as React.CSSProperties}
      >
        <div className="flex justify-between items-start">
          <h3 className="font-headline-md text-headline-md text-text-primary">Surge Risk & Tariff</h3>
          
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${surgeStatus === 'CRITICAL' ? 'bg-status-critical/10 border-status-critical/30' : surgeStatus === 'WARNING' ? 'bg-status-warning/10 border-status-warning/30' : 'bg-status-normal/10 border-status-normal/30'}`}>
            <div className={`relative w-2 h-2 rounded-full shadow-[0_0_8px_var(--tw-shadow-color)] animate-pulse-ring ${surgeStatus === 'CRITICAL' ? 'bg-status-critical shadow-status-critical' : surgeStatus === 'WARNING' ? 'bg-status-warning shadow-status-warning' : 'bg-status-normal shadow-status-normal'}`}></div>
            <span className={`font-label-mono text-label-mono font-bold tracking-widest uppercase ${surgeStatus === 'CRITICAL' ? 'text-status-critical' : surgeStatus === 'WARNING' ? 'text-status-warning' : 'text-status-normal'}`}>
              {surgeStatus}
            </span>
          </div>
        </div>
        
        <div className="mt-8 flex flex-col">
          <span className="font-label-mono text-label-mono text-text-secondary uppercase mb-2">Dynamic Multiplier</span>
          <div className="flex items-end gap-3">
            <span className="font-kpi-large text-kpi-large text-status-warning leading-none tabular-nums">
              x<AnimatedNumber value={tariffMultiplier} decimals={2} />
            </span>
            <span className="font-body-md text-body-md text-text-secondary mb-1">
              Active
            </span>
          </div>
        </div>
      </Tile>

      {/* Mitigation Actions */}
      <Tile 
        index={3} 
        className={`${isReport ? 'col-span-6' : 'md:col-span-4'} flex flex-col min-h-50 border-t-2 ${recommendedActions.throttle_active ? 'border-t-status-warning shadow-[0_0_30px_-10px_rgba(245,158,11,0.15)]' : recommendedActions.shed_stalls.length > 0 ? 'border-t-status-critical shadow-[0_0_30px_-10px_rgba(244,63,94,0.15)]' : 'border-t-transparent'}`}
      >
        <div className="flex justify-between items-start mb-6">
          <h3 className="font-headline-md text-headline-md text-text-primary">Mitigation Actions</h3>
          <span className="material-symbols-outlined text-text-secondary">shield</span>
        </div>

        {(!recommendedActions.throttle_active && recommendedActions.shed_stalls.length === 0) ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-secondary h-full p-2 text-center bg-surface-variant/20 rounded-lg border border-border-subtle/30">
            <span className="material-symbols-outlined text-3xl mb-2 text-status-normal/70" style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}>verified_user</span>
            <span className="font-label-mono text-status-normal font-bold text-xs uppercase tracking-widest mb-1">System Stable</span>
            <span className="font-body-sm text-text-secondary/80 max-w-60">
              If load exceeds <span className="text-text-primary font-bold">{settings.criticalThresholdPct}%</span> capacity, up to <span className="text-text-primary font-bold">3 bays</span> would be throttled to <span className="text-status-warning font-bold">~{recommendedActions.per_stall_cap_kw} kW</span>.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Throttling */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-variant/50 border border-border-subtle">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${recommendedActions.throttle_active ? 'bg-status-warning/20 text-status-warning' : 'bg-surface text-text-secondary'}`}>
                  <span className="material-symbols-outlined text-[18px]">speed</span>
                </div>
                <div className="flex flex-col w-full">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-label-mono text-text-primary uppercase tracking-wider text-xs">Throttling</span>
                    {recommendedActions.throttle_active ? (
                      <span className="font-label-mono text-status-warning font-bold">ACTIVE</span>
                    ) : (
                      <span className="font-label-mono text-text-secondary font-bold">OFF</span>
                    )}
                  </div>
                  {recommendedActions.throttle_active ? (
                    <div className="mt-1">
                      <div className="flex justify-between text-[10px] text-text-secondary font-label-mono mb-1">
                        <span>Cap: {recommendedActions.per_stall_cap_kw} kW</span>
                        <span>Normal: 150 kW</span>
                      </div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-status-warning h-full rounded-full transition-all duration-500" 
                          style={{ width: `${(recommendedActions.per_stall_cap_kw / 150) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <span className="font-body-sm text-text-secondary text-xs mt-0.5">Inactive</span>
                  )}
                </div>
              </div>
            </div>

            {/* Shed Stalls */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-variant/50 border border-border-subtle">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${recommendedActions.shed_stalls.length > 0 ? 'bg-status-critical/20 text-status-critical' : 'bg-surface text-text-secondary'}`}>
                  <span className="material-symbols-outlined text-[18px]">power_off</span>
                </div>
                <div className="flex flex-col w-full">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-label-mono text-text-primary uppercase tracking-wider text-xs">Load Shedding</span>
                    {recommendedActions.shed_stalls.length > 0 ? (
                      <span className="font-label-mono text-status-critical font-bold">ACTIVE</span>
                    ) : (
                      <span className="font-label-mono text-text-secondary font-bold">OFF</span>
                    )}
                  </div>
                  {recommendedActions.shed_stalls.length > 0 ? (
                     <div className="flex flex-wrap gap-1 mt-1">
                       {recommendedActions.shed_stalls.map(bay => (
                         <span key={bay} className="bg-status-critical/20 border border-status-critical/30 text-status-critical px-1.5 py-0.5 rounded text-[10px] font-bold font-label-mono uppercase">
                           Bay {bay}
                         </span>
                       ))}
                     </div>
                  ) : (
                     <span className="font-body-sm text-text-secondary text-xs mt-0.5">No bays shed</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Tile>

      {/* Bay Status Matrix inserted immediately after Mitigation Actions */}
      {bayMatrixSection}

      {/* Recent Surge Events */}
      <Tile 
        index={4} 
        className={`${isReport ? 'col-span-12' : 'md:col-span-4'} flex flex-col min-h-50 border-t-2 border-t-transparent`}
      >
        <div className="flex justify-between items-start mb-6">
          <h3 className="font-headline-md text-headline-md text-text-primary">Recent Surge Events</h3>
          <span 
            onClick={() => setIsEventModalOpen(true)}
            title="View Full History"
            className="material-symbols-outlined text-text-secondary cursor-pointer hover:text-primary transition-colors"
          >
            history
          </span>
        </div>

        {recentEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-secondary h-full">
             <span className="material-symbols-outlined text-4xl mb-2 opacity-50" style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}>schedule</span>
             <span className="font-body-md">No recent events</span>
          </div>
        ) : (
          <div className={`grid ${isReport ? 'grid-cols-2 gap-3 max-h-none' : 'grid-cols-1 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar'}`}>
            {recentEvents.slice(0, 5).map((event, idx) => {
              const minDiff = Math.floor((Date.now() - new Date(event.timestamp).getTime()) / 60000);
              const relTime = minDiff === 0 ? 'Just now' : minDiff < 60 ? `${minDiff}m ago` : `${Math.floor(minDiff/60)}h ${minDiff%60}m ago`;
              return (
                <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-surface-variant/30 border border-border-subtle/50">
                  <div className="flex flex-col">
                     <div className="flex items-center gap-2">
                       <div className={`w-2 h-2 rounded-full ${event.status === 'CRITICAL' ? 'bg-status-critical' : 'bg-status-warning'}`}></div>
                       <span className={`font-label-mono font-bold text-xs ${event.status === 'CRITICAL' ? 'text-status-critical' : 'text-status-warning'}`}>
                         {event.status}
                       </span>
                     </div>
                     <span className="font-label-mono text-text-secondary text-[10px] mt-1" title={new Date(event.timestamp).toLocaleTimeString()}>
                       {relTime}
                     </span>
                  </div>
                  <div className="text-right">
                     <span className="font-label-mono text-text-primary text-xs tracking-wider">TARIFF</span>
                     <div className="font-kpi-large text-status-warning leading-none tabular-nums text-sm">
                       x{event.multiplier.toFixed(2)}
                     </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Tile>

      {/* Full Event History Modal */}
      {isEventModalOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border-subtle rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-border-subtle">
              <h2 className="font-headline-lg text-text-primary flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">history</span>
                Session Event History
              </h2>
              <button 
                onClick={() => setIsEventModalOpen(false)}
                className="text-text-secondary hover:text-primary transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar flex flex-col gap-3">
              {recentEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-text-secondary py-12">
                   <span className="material-symbols-outlined text-4xl mb-2 opacity-50" style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}>schedule</span>
                   <span className="font-body-md">No events recorded this session</span>
                </div>
              ) : (
                recentEvents.map((event, idx) => {
                  const minDiff = Math.floor((Date.now() - new Date(event.timestamp).getTime()) / 60000);
                  const relTime = minDiff === 0 ? 'Just now' : minDiff < 60 ? `${minDiff}m ago` : `${Math.floor(minDiff/60)}h ${minDiff%60}m ago`;
                  return (
                    <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-surface-variant/30 border border-border-subtle/50">
                      <div className="flex flex-col">
                         <div className="flex items-center gap-2">
                           <div className={`w-2 h-2 rounded-full ${event.status === 'CRITICAL' ? 'bg-status-critical' : 'bg-status-warning'}`}></div>
                           <span className={`font-label-mono font-bold text-xs ${event.status === 'CRITICAL' ? 'text-status-critical' : 'text-status-warning'}`}>
                             {event.status}
                           </span>
                         </div>
                         <span className="font-label-mono text-text-secondary text-[10px] mt-1" title={new Date(event.timestamp).toLocaleTimeString()}>
                           {relTime}
                         </span>
                      </div>
                      <div className="text-right">
                         <span className="font-label-mono text-text-primary text-xs tracking-wider">TARIFF</span>
                         <div className="font-kpi-large text-status-warning leading-none tabular-nums text-sm">
                           x{event.multiplier.toFixed(2)}
                         </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
