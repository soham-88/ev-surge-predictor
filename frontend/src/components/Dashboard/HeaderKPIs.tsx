import { motion } from 'motion/react';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { useData } from '../../context/DataContext';

interface Props {
  latency?: number | null;
  gridFrequency?: number | null;
  ambientTemp?: number | null;
  isBackendOffline?: boolean;
  isWeatherLive?: boolean;
  isWeatherStale?: boolean;
}

export function HeaderKPIs({
  latency: propLatency,
  gridFrequency: propGridFrequency,
  ambientTemp: propAmbientTemp,
  isBackendOffline: propOffline,
  isWeatherLive: propWeatherLive,
  isWeatherStale: propWeatherStale,
}: Props) {
  const { headerKpis, isOffline: dataOffline, hasError, isPaused, setIsPaused } = useData();

  const isOffline = propOffline ?? (headerKpis.isOffline || dataOffline || hasError);
  const latency = propLatency !== undefined ? propLatency : headerKpis.latencyMs;
  const gridFrequency = propGridFrequency !== undefined ? propGridFrequency : headerKpis.gridFrequencyHz;
  const displayTemp = propAmbientTemp !== undefined ? propAmbientTemp : headerKpis.ambientTempC;
  const isWeatherLive = propWeatherLive !== undefined ? propWeatherLive : headerKpis.isWeatherLive;
  const isWeatherStale = propWeatherStale !== undefined ? propWeatherStale : headerKpis.isWeatherStale;

  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="fixed top-0 right-0 z-40 lg:w-[calc(100%-16rem)] w-full h-16 bg-background/80 backdrop-blur-xl border-b border-border flex items-center justify-end px-4 md:px-8 shadow-sm"
    >
      <div className="flex items-center gap-4 md:gap-8">
        
        {/* API Latency */}
        <div
          title={isOffline || latency === null ? 'API Latency: OFFLINE' : `API Latency: ${latency.toFixed(1)}ms`}
          className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)]"
        >
          <div className="relative w-2.5 h-2.5 ml-1">
            {isOffline || latency === null ? (
              <>
                <div className="absolute inset-0 rounded-full bg-status-critical opacity-75 pulse-critical"></div>
                <div className="relative w-full h-full rounded-full bg-status-critical"></div>
              </>
            ) : (
              <>
                <div className={`absolute inset-0 rounded-full opacity-75 ${latency < 50 ? 'bg-status-normal pulse-live' : 'bg-status-warning pulse-throttled'}`}></div>
                <div className={`relative w-full h-full rounded-full ${latency < 50 ? 'bg-status-normal' : 'bg-status-warning'}`}></div>
              </>
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-label-mono text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              API Latency
            </span>
            <span className={`font-headline-sm text-sm font-bold leading-tight ${isOffline || latency === null ? 'text-status-critical' : 'text-text-primary'}`}>
              {isOffline || latency === null ? (
                'OFFLINE'
              ) : (
                <AnimatedNumber value={latency} suffix="ms" decimals={1} />
              )}
            </span>
          </div>
        </div>

        {/* Grid Frequency */}
        <div
          title={isOffline || gridFrequency === null ? 'Grid Frequency: Unavailable' : `Grid Frequency: ${gridFrequency.toFixed(2)}Hz`}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)]"
        >
          <span className={`material-symbols-outlined text-[20px] ${isOffline || gridFrequency === null ? 'text-text-secondary opacity-60' : 'text-tertiary'}`} style={{ fontVariationSettings: "'FILL' 1" }}>
            monitor_heart
          </span>
          <div className="flex flex-col">
            <span className="font-label-mono text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Grid Freq
            </span>
            <span className={`font-headline-sm text-sm font-bold leading-tight ${isOffline || gridFrequency === null ? 'text-text-secondary opacity-80' : 'text-text-primary'}`}>
              {isOffline || gridFrequency === null ? (
                '--'
              ) : (
                <AnimatedNumber value={gridFrequency} suffix="Hz" decimals={2} />
              )}
            </span>
          </div>
        </div>

        {/* Ambient Temp */}
        <div
          title={
            isWeatherLive && displayTemp !== null
              ? `Live Temperature: ${displayTemp.toFixed(1)}°C`
              : isWeatherStale && displayTemp !== null
              ? `Stale Temperature: ${displayTemp.toFixed(1)}°C`
              : 'Temperature: Unavailable'
          }
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)] relative"
        >
          {isWeatherLive && displayTemp !== null && (
            <div className="absolute -top-2 -right-2 bg-status-normal text-surface font-label-mono text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase shadow-sm">
              LIVE
            </div>
          )}
          {isWeatherStale && displayTemp !== null && (
            <div className="absolute -top-2 -right-2 bg-status-warning text-surface-container font-label-mono text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase shadow-sm">
              STALE
            </div>
          )}
          <span
            className={`material-symbols-outlined text-[20px] ${
              isWeatherLive ? 'text-error' : 'text-text-secondary opacity-60'
            }`}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            thermostat
          </span>
          <div className="flex flex-col">
            <span className="font-label-mono text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Temp
            </span>
            <span
              className={`font-headline-sm text-sm font-bold leading-tight ${
                isWeatherLive
                  ? 'text-text-primary'
                  : 'text-text-secondary opacity-80'
              }`}
            >
              {displayTemp !== null ? (
                <AnimatedNumber value={displayTemp} suffix="°C" decimals={1} />
              ) : (
                '--'
              )}
            </span>
          </div>
        </div>

        {/* Live Indicator Action */}
        <button 
          onClick={() => setIsPaused(!isPaused)}
          title={isOffline ? "Backend Offline" : (isPaused ? "Resume Live Feed" : "Pause Live Feed")}
          disabled={isOffline}
          className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center relative ${
            isOffline
              ? 'opacity-40 cursor-not-allowed text-text-secondary'
              : 'hover:scale-105 active:scale-95 cursor-pointer ' + (isPaused ? 'bg-surface-variant text-text-secondary' : 'hover:bg-glass-fill text-primary')
          }`}
        >
          {!isPaused && !isOffline && <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-ring"></div>}
          <span className="material-symbols-outlined">
            {isOffline ? 'cloud_off' : (isPaused ? 'play_arrow' : 'sensors')}
          </span>
        </button>
      </div>
    </motion.header>
  );
}
