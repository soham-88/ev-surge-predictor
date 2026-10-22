import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { api } from '../../services/api';
import { useData } from '../../context/DataContext';

interface Props {
  latency: number;
  gridFrequency: number;
  ambientTemp: number;
}

export function HeaderKPIs({ latency, gridFrequency, ambientTemp }: Props) {
  const { isPaused, setIsPaused } = useData();
  const [liveWeather, setLiveWeather] = useState<{ temp: number | null, isStale: boolean }>({ temp: null, isStale: false });

  useEffect(() => {
    let mounted = true;
    const fetchWeather = async () => {
      try {
        const data = await api.getWeather();
        if (mounted) {
          setLiveWeather({ temp: data.temperature_c, isStale: false });
        }
      } catch (e) {
        if (mounted) {
          setLiveWeather(prev => ({ ...prev, isStale: true }));
        }
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const displayTemp = liveWeather.temp !== null ? liveWeather.temp : ambientTemp;

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
          title={`Latency: ${latency.toFixed(1)}ms`}
          className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)]"
        >
          <div className="relative w-2.5 h-2.5 ml-1">
            <div className={`absolute inset-0 rounded-full opacity-75 ${latency < 50 ? 'bg-status-normal pulse-live' : 'bg-status-warning pulse-throttled'}`}></div>
            <div className={`relative w-full h-full rounded-full ${latency < 50 ? 'bg-status-normal' : 'bg-status-warning'}`}></div>
          </div>
          <div className="flex flex-col">
            <span className="font-label-mono text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              API Latency
            </span>
            <span className="font-headline-sm text-sm font-bold text-text-primary leading-tight">
              <AnimatedNumber value={latency} suffix="ms" decimals={1} />
            </span>
          </div>
        </div>

        {/* Grid Frequency */}
        <div
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)]"
        >
          <span className="material-symbols-outlined text-[20px] text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>
            monitor_heart
          </span>
          <div className="flex flex-col">
            <span className="font-label-mono text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Grid Freq
            </span>
            <span className="font-headline-sm text-sm font-bold text-text-primary leading-tight">
              <AnimatedNumber value={gridFrequency} suffix="Hz" decimals={2} />
            </span>
          </div>
        </div>

        {/* Ambient Temp */}
        <div
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-surface-container/50 border border-border shadow-[0_0_15px_rgba(0,0,0,0.1)] relative"
        >
          {liveWeather.temp !== null && !liveWeather.isStale && (
            <div className="absolute -top-2 -right-2 bg-status-normal text-surface font-label-mono text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase shadow-sm">
              LIVE
            </div>
          )}
          {liveWeather.isStale && (
            <div className="absolute -top-2 -right-2 bg-status-warning text-surface-container font-label-mono text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase shadow-sm">
              STALE
            </div>
          )}
          <span className={`material-symbols-outlined text-[20px] ${liveWeather.isStale ? 'text-text-secondary' : 'text-error'}`} style={{ fontVariationSettings: "'FILL' 1" }}>
            thermostat
          </span>
          <div className="flex flex-col">
            <span className="font-label-mono text-[10px] uppercase tracking-wider text-text-secondary leading-none">
              Temp
            </span>
            <span className={`font-headline-sm text-sm font-bold leading-tight ${liveWeather.isStale ? 'text-text-secondary opacity-80' : 'text-text-primary'}`}>
              <AnimatedNumber value={displayTemp} suffix="°C" decimals={1} />
            </span>
          </div>
        </div>

        {/* Live Indicator Action */}
        <button 
          onClick={() => setIsPaused(!isPaused)}
          title={isPaused ? "Resume Live Feed" : "Pause Live Feed"}
          className={`p-2 rounded-full transition-all duration-300 hover:scale-105 active:scale-95 flex items-center justify-center relative cursor-pointer ${isPaused ? 'bg-surface-variant text-text-secondary' : 'hover:bg-glass-fill text-primary'}`}
        >
          {!isPaused && <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-ring"></div>}
          <span className="material-symbols-outlined">
            {isPaused ? 'play_arrow' : 'sensors'}
          </span>
        </button>
      </div>
    </motion.header>
  );
}
