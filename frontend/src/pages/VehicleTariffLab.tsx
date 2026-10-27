import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Bike, Car, Zap, Gauge, Activity, Info, ArrowUpRight } from 'lucide-react';
import { useTariff } from '../context/TariffContext';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { Skeleton, SkeletonText, ErrorState } from '../components/ui';

interface VehicleTariffData {
  vehicle_type: string;
  vehicle_label: string;
  avg_power_kw: number;
  base_surge_multiplier: number;
  vehicle_multiplier: number;
  final_tariff_multiplier: number;
}

interface CategoryConfig {
  type: string;
  fallbackLabel: string;
  defaultKw: number;
  defaultMultiplier: number;
  Icon: typeof Bike;
  accentColor: string;
  badgeBg: string;
  badgeBorder: string;
  iconBg: string;
  glowColor: string;
}

const CATEGORIES: CategoryConfig[] = [
  {
    type: 'two_wheeler',
    fallbackLabel: 'Two-Wheeler EV (e.g., Ola S1)',
    defaultKw: 1.2,
    defaultMultiplier: 0.85,
    Icon: Bike,
    accentColor: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/10',
    badgeBorder: 'border-emerald-500/30',
    iconBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    glowColor: 'rgba(16, 185, 129, 0.25)',
  },
  {
    type: 'standard_4w',
    fallbackLabel: 'Standard 4W EV (e.g., Tata Nexon EV)',
    defaultKw: 7.2,
    defaultMultiplier: 1.00,
    Icon: Car,
    accentColor: 'text-primary',
    badgeBg: 'bg-primary/10',
    badgeBorder: 'border-primary/30',
    iconBg: 'bg-primary/15 text-primary border-primary/30',
    glowColor: 'rgba(138, 235, 255, 0.25)',
  },
  {
    type: 'fast_charging',
    fallbackLabel: 'Fast-Charging EV (e.g., MG ZS EV DC)',
    defaultKw: 45.0,
    defaultMultiplier: 1.35,
    Icon: Zap,
    accentColor: 'text-status-warning',
    badgeBg: 'bg-status-warning/10',
    badgeBorder: 'border-status-warning/30',
    iconBg: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    glowColor: 'rgba(245, 158, 11, 0.35)',
  },
];

function VehicleTariffSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-gap-grid">
      {Array.from({ length: 3 }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl p-6 backdrop-blur-xl bg-surface-container-lowest/60 border border-border-subtle/50 flex flex-col justify-between min-h-[380px]"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="w-12 h-12 rounded-xl" />
              <Skeleton className="w-16 h-6 rounded-full" />
            </div>
            <SkeletonText className="w-3/4 h-7 mb-2" />
            <SkeletonText className="w-1/2 h-4 mb-6" />
          </div>

          <div className="my-4 p-4 rounded-xl bg-surface-container-lowest/50 border border-border-subtle/50 flex flex-col gap-3">
            <SkeletonText className="w-40 h-3" />
            <Skeleton className="w-28 h-10 rounded" />
            <div className="pt-3 border-t border-border-subtle/40 flex justify-between">
              <SkeletonText className="w-24 h-3" />
              <SkeletonText className="w-20 h-3" />
            </div>
          </div>

          <div className="pt-2 flex justify-between">
            <SkeletonText className="w-28 h-4" />
            <SkeletonText className="w-16 h-4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VehicleTariffLab() {
  const { baseSurgeMultiplier, isSimulationActive } = useTariff();
  const [tariffs, setTariffs] = useState<Record<string, VehicleTariffData | null>>({
    two_wheeler: null,
    standard_4w: null,
    fast_charging: null,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchTariffs = useCallback(async (isRetry = false) => {
    if (isRetry) {
      setIsRetrying(true);
    } else {
      setIsLoading(true);
    }
    setHasError(false);
    setErrorMessage(null);

    const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const API_BASE = rawApiUrl.endsWith('/api/v1')
      ? rawApiUrl
      : `${rawApiUrl.replace(/\/+$/, '')}/api/v1`;

    const fetchCategory = async (type: string): Promise<VehicleTariffData | null> => {
      const res = await fetch(`${API_BASE}/tariff/vehicle-adjusted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_surge_multiplier: baseSurgeMultiplier,
          vehicle_type: type,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to calculate tariff for ${type}`);
      }
      return await res.json();
    };

    try {
      const [twoW, std4w, fastC] = await Promise.all([
        fetchCategory('two_wheeler'),
        fetchCategory('standard_4w'),
        fetchCategory('fast_charging'),
      ]);
      setTariffs({
        two_wheeler: twoW,
        standard_4w: std4w,
        fast_charging: fastC,
      });
      setHasError(false);
    } catch (err: any) {
      console.warn('Could not reach /api/v1/tariff/vehicle-adjusted', err);
      setHasError(true);
      setErrorMessage('Unable to connect to the Vehicle Tariff service. The backend may be offline.');
    } finally {
      setIsLoading(false);
      setIsRetrying(false);
    }
  }, [baseSurgeMultiplier]);

  useEffect(() => {
    fetchTariffs(false);
  }, [fetchTariffs]);

  // Compute dynamic comparison between Fast-Charging and Standard 4W
  const fcData = tariffs.fast_charging;
  const stdData = tariffs.standard_4w;

  let comparisonContent: ReactNode = null;
  if (fcData && stdData && stdData.final_tariff_multiplier > 0) {
    const fcMultiplier = fcData.final_tariff_multiplier;
    const stdMultiplier = stdData.final_tariff_multiplier;
    const diffPct = ((fcMultiplier - stdMultiplier) / stdMultiplier) * 100;
    const diffPctStr = diffPct.toFixed(1);
    const fcMultiplierStr = fcMultiplier.toFixed(2);

    comparisonContent = (
      <span>
        At current grid conditions, Fast-Charging EVs pay{' '}
        <span className="text-amber-400 font-bold font-label-mono">{fcMultiplierStr}x</span> base rate —{' '}
        <span className="text-status-critical font-bold font-label-mono">{diffPctStr}%</span> more than Standard 4W EVs, due to higher instantaneous load contribution.
      </span>
    );
  } else {
    // Neutral fallback placeholder while loading or if offline
    const fcMult = (baseSurgeMultiplier * 1.35).toFixed(2);
    comparisonContent = (
      <span>
        At current grid conditions, Fast-Charging EVs pay{' '}
        <span className="text-amber-400 font-bold font-label-mono">{fcMult}x</span> base rate —{' '}
        <span className="text-status-critical font-bold font-label-mono">35.0%</span> more than Standard 4W EVs, due to higher instantaneous load contribution.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-gap-grid max-w-7xl mx-auto">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-surface-container-lowest/40 backdrop-blur-xl border border-border-subtle shadow-lg">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-2xl">electric_car</span>
            <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">
              Vehicle Tariff Lab
            </h1>
          </div>
          <p className="font-body-md text-text-secondary">
            Category-calibrated dynamic pricing adjusted for vehicle power draw and peak surge impact
          </p>
        </div>

        {/* State Indicator Badges */}
        <div className="flex items-center gap-3">
          {/* Base Surge Multiplier Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-variant/40 border border-border-subtle">
            <Activity className={`w-4 h-4 text-primary ${isLoading ? 'animate-spin' : ''}`} />
            <span className="font-label-mono text-xs text-text-secondary uppercase">Base Surge</span>
            <span className="font-label-mono text-xs font-bold text-text-primary">
              x{baseSurgeMultiplier.toFixed(2)}
            </span>
          </div>

          {/* Simulation vs Live Badge */}
          {isSimulationActive ? (
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-status-warning/10 border border-status-warning/40 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <div className="relative w-2.5 h-2.5">
                <div className="absolute inset-0 rounded-full bg-status-warning pulse-throttled opacity-75" />
                <div className="relative w-full h-full rounded-full bg-status-warning" />
              </div>
              <span className="font-label-mono text-xs font-bold text-status-warning tracking-widest uppercase">
                SIMULATION ACTIVE
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-primary/10 border border-primary/40 shadow-[0_0_15px_rgba(138,235,255,0.2)]">
              <div className="relative w-2.5 h-2.5">
                <div className="absolute inset-0 rounded-full bg-primary pulse-live opacity-75" />
                <div className="relative w-full h-full rounded-full bg-primary" />
              </div>
              <span className="font-label-mono text-xs font-bold text-primary tracking-widest uppercase">
                LIVE
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3 Glassmorphism Cards Row */}
      {isLoading ? (
        <VehicleTariffSkeleton />
      ) : hasError && !tariffs.two_wheeler && !tariffs.standard_4w && !tariffs.fast_charging ? (
        <div className="py-8 max-w-2xl mx-auto w-full">
          <ErrorState
            title="Vehicle Tariff Engine Offline"
            message={errorMessage || 'Unable to connect to the dynamic vehicle tariff endpoint. Please ensure the backend is running.'}
            onRetry={() => fetchTariffs(true)}
            isRetrying={isRetrying}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-gap-grid">
          {CATEGORIES.map((cat, idx) => {
            const tariff = tariffs[cat.type];
            const finalMult = tariff?.final_tariff_multiplier ?? (baseSurgeMultiplier * cat.defaultMultiplier);
            const vehicleMult = tariff?.vehicle_multiplier ?? cat.defaultMultiplier;
            const avgPower = tariff?.avg_power_kw ?? cat.defaultKw;
            const label = tariff?.vehicle_label ?? cat.fallbackLabel;

            // Fast charging condition: highlight with red/amber glowing border if final_tariff_multiplier > 2.0
            const isHighCost = cat.type === 'fast_charging' && finalMult > 2.0;

            return (
              <motion.div
                key={cat.type}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: idx * 0.05 }}
              style={
                isHighCost
                  ? {
                      boxShadow: '0 0 30px rgba(244, 63, 94, 0.4), 0 0 15px rgba(245, 158, 11, 0.3)',
                      borderColor: 'rgba(244, 63, 94, 0.85)',
                    }
                  : undefined
              }
              className={`relative rounded-2xl p-6 backdrop-blur-xl bg-glass-fill border transition-all duration-300 flex flex-col justify-between overflow-hidden ${
                isHighCost
                  ? 'border-status-critical/80 animate-pulse-fast'
                  : 'border-border-subtle hover:border-primary/40'
              }`}
            >
              {/* Subtle Ambient Radial Gradient */}
              <div
                className="pointer-events-none absolute -top-16 -right-16 w-36 h-36 rounded-full blur-3xl opacity-30"
                style={{ backgroundColor: cat.glowColor }}
              />

              {/* Card Header: Icon & Category Label */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-xl border ${cat.iconBg}`}>
                    <cat.Icon className="w-6 h-6" />
                  </div>
                  {isHighCost ? (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold font-label-mono bg-status-critical/20 text-status-critical border border-status-critical/40 uppercase tracking-wider animate-pulse">
                      High Cost Peak
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold font-label-mono bg-surface-variant/40 text-text-secondary border border-border-subtle uppercase tracking-wider">
                      Tier {idx + 1}
                    </span>
                  )}
                </div>

                <h2 className="font-headline-md text-headline-md text-text-primary mb-1">
                  {label}
                </h2>
                <div className="flex items-center gap-2 font-label-mono text-xs text-text-secondary mb-6">
                  <Gauge className="w-3.5 h-3.5 text-text-secondary" />
                  <span>Avg Draw: <strong className="text-text-primary">{avgPower.toFixed(1)} kW</strong></span>
                </div>
              </div>

              {/* Multiplier Hero Display */}
              <div className="my-4 p-4 rounded-xl bg-surface-container-lowest/50 border border-border-subtle/80 flex flex-col">
                <span className="font-label-mono text-xs text-text-secondary uppercase tracking-widest mb-1">
                  Effective Tariff Multiplier
                </span>
                <div className="flex items-baseline gap-2">
                  <motion.div
                    key={finalMult}
                    initial={{ scale: 0.95, opacity: 0.7 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                    className="flex items-baseline"
                  >
                    <AnimatedNumber
                      value={finalMult}
                      decimals={2}
                      suffix="x"
                      className={`text-kpi-large font-bold font-label-mono tracking-tight ${
                        isHighCost ? 'text-status-critical' : cat.accentColor
                      }`}
                    />
                  </motion.div>
                  <span className="font-label-mono text-xs text-text-secondary">rate</span>
                </div>

                {/* Calculation Breakdown Formula */}
                <div className="mt-3 pt-3 border-t border-border-subtle/60 flex items-center justify-between text-xs font-label-mono text-text-secondary">
                  <span>Base x Category</span>
                  <span className="text-text-primary font-bold">
                    {baseSurgeMultiplier.toFixed(2)}x &times; {vehicleMult.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Card Footer Key Attributes */}
              <div className="pt-2 flex items-center justify-between text-xs font-label-mono text-text-secondary">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary/60" />
                  <span>Category Multiplier:</span>
                </div>
                <span className="text-text-primary font-bold font-label-mono">
                  {vehicleMult.toFixed(2)}x
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
      )}

      {/* Auto-generated Comparison Sentence Callout Tile */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        className="p-6 rounded-2xl bg-glass-fill backdrop-blur-xl border border-border-subtle relative overflow-hidden shadow-lg"
      >
        <div className="pointer-events-none absolute -left-12 -top-12 w-40 h-40 rounded-full bg-primary/10 blur-3xl" />
        
        <div className="relative flex items-start gap-4">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 text-primary shrink-0 mt-0.5">
            <Info className="w-5 h-5" />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="font-label-mono text-xs font-bold text-primary tracking-wider uppercase">
                Grid Dynamic Impact Assessment
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="font-body-md text-text-primary text-base leading-relaxed">
              {comparisonContent}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
