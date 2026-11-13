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
  isDrawerOpen?: boolean;
  onToggleDrawer?: () => void;
}

export function HeaderKPIs({
  latency: propLatency,
  gridFrequency: propGridFrequency,
  ambientTemp: propAmbientTemp,
  isBackendOffline: propOffline,
  isWeatherLive: propWeatherLive,
  isWeatherStale: propWeatherStale,
  isDrawerOpen = false,
  onToggleDrawer,
}: Props) {
  const { headerKpis, isOffline: dataOffline, hasError, isPaused, setIsPaused } = useData();

  const isOffline = propOffline ?? (headerKpis.isOffline || dataOffline || hasError);
  const latency = propLatency !== undefined ? propLatency : headerKpis.latencyMs;
  const gridFrequency = propGridFrequency !== undefined ? propGridFrequency : headerKpis.gridFrequencyHz;
  const displayTemp = propAmbientTemp !== undefined ? propAmbientTemp : headerKpis.ambientTempC;
  const isWeatherLive = propWeatherLive !== undefined ? propWeatherLive : headerKpis.isWeatherLive;
  const isWeatherStale = propWeatherStale !== undefined ? propWeatherStale : headerKpis.isWeatherStale;

  const latencyStatusText = isOffline || latency === null ? 'Offline' : (latency < 50 ? 'Normal' : 'Warning');

  return (
    <motion.header
      role="banner"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="fixed top-0 right-0 z-40 md:w-[calc(100%-16rem)] w-full min-h-16 h-auto bg-background/90 backdrop-blur-xl border-b border-border flex items-center justify-between px-3 sm:px-4 md:px-8 shadow-sm py-2"
    >
      {/* Mobile Drawer Toggle & Logo */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={onToggleDrawer}
          aria-label={isDrawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isDrawerOpen}
          aria-controls="mobile-navigation-drawer"
          className="flex items-center justify-center min-w-[44px] min-h-[44px] -ml-2 rounded-lg text-text-primary hover:bg-surface-container active:bg-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
        >
          <span className="material-symbols-outlined text-2xl">
            {isDrawerOpen ? 'close' : 'menu'}
          </span>
        </button>
        <span className="font-headline-md text-xs sm:text-sm font-bold tracking-wider text-primary truncate max-w-[90px] xs:max-w-none">
          GRID PULSE
        </span>
      </div>

      {/* Desktop Spacer */}
      <div className="hidden md:block" />

      {/* Status Pills Container: Wraps/shrinks on small screens */}
      <div className="flex items-center flex-wrap justify-end gap-1.5 sm:gap-2.5 md:gap-4 max-w-full">
        {/* API Latency */}
        <div
          title={isOffline || latency === null ? 'API Latency: OFFLINE' : `API Latency: ${latency.toFixed(1)}ms (${latencyStatusText})`}
          className="flex items-center gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)] min-h-[40px]"
        >
          <div className="relative w-2.5 h-2.5">
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
            <span className="font-label-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Latency
            </span>
            <span className={`font-headline-sm text-xs sm:text-sm font-bold leading-tight ${isOffline || latency === null ? 'text-status-critical' : 'text-text-primary'}`}>
              {isOffline || latency === null ? (
                'OFFLINE'
              ) : (
                <AnimatedNumber value={latency} suffix="ms" decimals={1} />
              )}
            </span>
            <span className="sr-only">Status: {latencyStatusText}</span>
          </div>
        </div>

        {/* Grid Frequency */}
        <div
          title={isOffline || gridFrequency === null ? 'Grid Frequency: Unavailable' : `Grid Frequency: ${gridFrequency.toFixed(2)}Hz (Normal 50Hz nominal)`}
          className="flex items-center gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)] min-h-[40px]"
        >
          <span
            className={`material-symbols-outlined text-[18px] sm:text-[20px] ${isOffline || gridFrequency === null ? 'text-text-secondary' : 'text-tertiary'}`}
            style={{ fontVariationSettings: "'FILL' 1" }}
            aria-hidden="true"
          >
            monitor_heart
          </span>
          <div className="flex flex-col">
            <span className="font-label-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Grid Freq
            </span>
            <span className={`font-headline-sm text-xs sm:text-sm font-bold leading-tight ${isOffline || gridFrequency === null ? 'text-text-secondary' : 'text-text-primary'}`}>
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
          className="flex items-center gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)] relative min-h-[40px]"
        >
          {isWeatherLive && displayTemp !== null && (
            <div className="absolute -top-2 -right-1 bg-status-normal text-surface font-label-mono text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase shadow-sm">
              LIVE
            </div>
          )}
          {isWeatherStale && displayTemp !== null && (
            <div className="absolute -top-2 -right-1 bg-status-warning text-surface-container font-label-mono text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase shadow-sm">
              STALE
            </div>
          )}
          <span
            className={`material-symbols-outlined text-[18px] sm:text-[20px] ${
              isWeatherLive ? 'text-error' : 'text-text-secondary'
            }`}
            style={{ fontVariationSettings: "'FILL' 1" }}
            aria-hidden="true"
          >
            thermostat
          </span>
          <div className="flex flex-col">
            <span className="font-label-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Temp
            </span>
            <span
              className={`font-headline-sm text-xs sm:text-sm font-bold leading-tight ${
                isWeatherLive
                  ? 'text-text-primary'
                  : 'text-text-secondary'
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
          aria-label={isOffline ? 'Backend Offline' : (isPaused ? 'Resume live telemetry stream' : 'Pause live telemetry stream')}
          title={isOffline ? 'Backend Offline' : (isPaused ? 'Resume Live Feed' : 'Pause Live Feed')}
          disabled={isOffline}
          className={`min-w-[40px] min-h-[40px] p-2 rounded-full transition-all duration-300 flex items-center justify-center relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            isOffline
              ? 'opacity-40 cursor-not-allowed text-text-secondary'
              : 'hover:scale-105 active:scale-95 cursor-pointer ' + (isPaused ? 'bg-surface-variant text-text-secondary' : 'hover:bg-glass-fill text-primary')
          }`}
        >
          {!isPaused && !isOffline && (
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-ring" aria-hidden="true"></div>
          )}
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            {isOffline ? 'cloud_off' : (isPaused ? 'play_arrow' : 'sensors')}
          </span>
        </button>
      </div>
    </motion.header>
  );
}
