import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Bike, Car, Zap, Gauge, Activity, Info, ArrowUpRight, Calculator, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { useTariff } from '../context/TariffContext';
import { useData } from '../context/DataContext';
import { api } from '../services/api';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { Skeleton, SkeletonText, ErrorState, Tile } from '../components/ui';
import type { TariffCurveResponse, TariffCurvePoint } from '../types/telemetry';
import {
  calculateTariffEstimate,
  CATEGORY_DEFAULTS,
  DEFAULT_ILLUSTRATIVE_BASE_RATE,
  formatRupees,
} from '../utils/tariffEstimate';

interface VehicleTariffData {
  vehicle_type: string;
  vehicle_label: string;
  avg_power_kw: number;
  base_surge_multiplier: number;
  vehicle_multiplier: number;
  final_tariff_multiplier: number;
}

interface CategoryConfig {
  type: 'two_wheeler' | 'standard_4w' | 'fast_charging';
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-gap-grid items-stretch">
      {Array.from({ length: 3 }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl p-6 backdrop-blur-xl bg-surface-container-lowest/60 border border-border-subtle/50 flex flex-col justify-between h-full"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="w-12 h-12 rounded-xl" />
              <Skeleton className="w-16 h-6 rounded-full" />
            </div>
            <SkeletonText className="w-3/4 h-7 mb-2" />
            <SkeletonText className="w-1/2 h-4 mb-6" />
          </div>

          <div className="mt-auto p-4 rounded-xl bg-surface-container-lowest/50 border border-border-subtle/50 flex flex-col gap-3">
            <SkeletonText className="w-40 h-3" />
            <Skeleton className="w-28 h-10 rounded" />
            <div className="pt-3 border-t border-border-subtle/40 flex justify-between">
              <SkeletonText className="w-24 h-3" />
              <SkeletonText className="w-20 h-3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CurveTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: number | string }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0]?.payload as TariffCurvePoint;
  return (
    <div className="p-3 rounded-lg bg-surface-container-lowest/95 border border-border-subtle shadow-xl text-xs font-label-mono backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 mb-2 pb-1.5 border-b border-border-subtle/50">
        <span className="text-text-primary font-bold">Grid Load: {label}%</span>
        {point && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              point.surge_status === 'CRITICAL'
                ? 'bg-status-critical/20 text-status-critical border border-status-critical/30'
                : point.surge_status === 'WARNING'
                ? 'bg-status-warning/20 text-status-warning border border-status-warning/30'
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}
          >
            {point.surge_status} ({point.base_multiplier?.toFixed(2)}x)
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {payload.map((item: any) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-text-secondary">{item.name}</span>
            </div>
            <span className="font-bold text-text-primary">{item.value?.toFixed(2)}x</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getLocalFallbackCurve(): TariffCurveResponse {
  const bands = [
    {
      name: 'Normal',
      surge_status: 'NORMAL' as const,
      min_pct: 0,
      max_pct: 65,
      base_multiplier: 1.0,
      multipliers: { two_wheeler: 0.85, standard_4w: 1.0, fast_charging: 1.35 },
    },
    {
      name: 'Warning',
      surge_status: 'WARNING' as const,
      min_pct: 65,
      max_pct: 80,
      base_multiplier: 1.2,
      multipliers: { two_wheeler: 1.02, standard_4w: 1.2, fast_charging: 1.62 },
    },
    {
      name: 'Critical',
      surge_status: 'CRITICAL' as const,
      min_pct: 80,
      max_pct: 95,
      base_multiplier: 1.45,
      multipliers: { two_wheeler: 1.232, standard_4w: 1.45, fast_charging: 1.958 },
    },
    {
      name: 'Severe',
      surge_status: 'CRITICAL' as const,
      min_pct: 95,
      max_pct: 100,
      base_multiplier: 1.8,
      multipliers: { two_wheeler: 1.53, standard_4w: 1.8, fast_charging: 2.43 },
    },
  ];
  const points: TariffCurvePoint[] = [];
  for (let pct = 0; pct <= 100; pct++) {
    let surge: 'NORMAL' | 'WARNING' | 'CRITICAL' = 'NORMAL';
    let base = 1.0;
    if (pct >= 80) {
      surge = 'CRITICAL';
      base = pct >= 95 ? 1.8 : 1.45;
    } else if (pct >= 65) {
      surge = 'WARNING';
      base = 1.2;
    }
    points.push({
      utilization_pct: pct,
      surge_status: surge,
      base_multiplier: base,
      two_wheeler: Math.round(base * 0.85 * 1000) / 1000,
      standard_4w: Math.round(base * 1.0 * 1000) / 1000,
      fast_charging: Math.round(base * 1.35 * 1000) / 1000,
    });
  }
  return {
    bands,
    points,
    categories: {
      two_wheeler: {
        key: 'two_wheeler',
        label: 'Two-Wheeler EV (e.g., Ola S1)',
        category_multiplier: 0.85,
        avg_power_kw: 1.2,
      },
      standard_4w: {
        key: 'standard_4w',
        label: 'Standard 4W EV (e.g., Tata Nexon EV)',
        category_multiplier: 1.0,
        avg_power_kw: 7.2,
      },
      fast_charging: {
        key: 'fast_charging',
        label: 'Fast-Charging EV (e.g., MG ZS EV DC)',
        category_multiplier: 1.35,
        avg_power_kw: 45.0,
      },
    },
  };
}

export function VehicleTariffLab() {
  const { baseSurgeMultiplier, isSimulationActive } = useTariff();

  // Safely access DataContext if present
  let predictData = null;
  let simulateData = null;
  let isSimulationMode = false;
  try {
    const dataCtx = useData();
    predictData = dataCtx.predictData;
    simulateData = dataCtx.simulateData;
    isSimulationMode = dataCtx.isSimulationMode;
  } catch {
    // Graceful fallback outside DataProvider
  }

  const currentCapacityUtilizationPct =
    isSimulationMode && simulateData && predictData
      ? (simulateData.simulated_peak_kw / predictData.transformer_capacity_kw) * 100
      : (predictData?.capacity_utilization_pct ?? 0);

  const [tariffs, setTariffs] = useState<Record<string, VehicleTariffData | null>>({
    two_wheeler: null,
    standard_4w: null,
    fast_charging: null,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Curve data state
  const [curveData, setCurveData] = useState<TariffCurveResponse | null>(null);

  // Session Cost Estimator state
  const [selectedCategory, setSelectedCategory] = useState<'two_wheeler' | 'standard_4w' | 'fast_charging'>('standard_4w');
  const [energyKwh, setEnergyKwh] = useState<number>(30);
  const [baseRate, setBaseRate] = useState<number>(DEFAULT_ILLUSTRATIVE_BASE_RATE);

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

  // Load real curve data from GET /api/v1/tariff/curve
  useEffect(() => {
    let isMounted = true;
    api
      .getTariffCurve()
      .then((data) => {
        if (isMounted) {
          setCurveData(data);
        }
      })
      .catch((err) => {
        console.warn('Could not load /api/v1/tariff/curve, using fallback curve:', err);
        if (isMounted) {
          setCurveData(getLocalFallbackCurve());
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleCategoryChange = (category: 'two_wheeler' | 'standard_4w' | 'fast_charging') => {
    setSelectedCategory(category);
    setEnergyKwh(CATEGORY_DEFAULTS[category].energyKwh);
  };

  // Estimator calculation
  const activeTariff = tariffs[selectedCategory];
  const activeEffectiveMultiplier =
    activeTariff?.final_tariff_multiplier ??
    baseSurgeMultiplier * CATEGORY_DEFAULTS[selectedCategory].avgPowerKw;
  const activeAvgPower =
    activeTariff?.avg_power_kw ?? CATEGORY_DEFAULTS[selectedCategory].avgPowerKw;

  const estimate = useMemo(() => {
    return calculateTariffEstimate({
      energyKwh,
      baseRateRupeesPerKwh: baseRate,
      effectiveMultiplier: activeEffectiveMultiplier,
      avgPowerKw: activeAvgPower,
    });
  }, [energyKwh, baseRate, activeEffectiveMultiplier, activeAvgPower]);

  // Fast-Charging vs Standard 4W impact comparison
  const fcData = tariffs.fast_charging;
  const stdData = tariffs.standard_4w;

  let comparisonContent: ReactNode;
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
    const fcMult = (baseSurgeMultiplier * 1.35).toFixed(2);
    comparisonContent = (
      <span>
        At current grid conditions, Fast-Charging EVs pay{' '}
        <span className="text-amber-400 font-bold font-label-mono">{fcMult}x</span> base rate —{' '}
        <span className="text-status-critical font-bold font-label-mono">35.0%</span> more than Standard 4W EVs, due to higher instantaneous load contribution.
      </span>
    );
  }

  const curvePoints = curveData?.points ?? getLocalFallbackCurve().points;
  const referenceLineX = Math.min(100, Math.max(0, Math.round(currentCapacityUtilizationPct)));

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
            Category-calibrated dynamic pricing adjusted for vehicle power draw and peak surge impact. Average power draw figures (1.2 kW, 7.2 kW, 45 kW) and base rate (₹12.00/kWh) are illustrative assumptions.
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
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-status-warning/10 border border-status-warning/40 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
            >
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

      {/* Row 1: 3 Equal Height, Aligned Glassmorphism Cards */}
      {isLoading ? (
        <VehicleTariffSkeleton />
      ) : hasError && !tariffs.two_wheeler && !tariffs.standard_4w && !tariffs.fast_charging ? (
        <div className="py-8 max-w-2xl mx-auto w-full">
          <ErrorState
            title="Vehicle Tariff Engine Offline"
            message={
              errorMessage ||
              'Unable to connect to the dynamic vehicle tariff endpoint. Please ensure the backend is running.'
            }
            onRetry={() => fetchTariffs(true)}
            isRetrying={isRetrying}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-gap-grid items-stretch">
          {CATEGORIES.map((cat, idx) => {
            const tariff = tariffs[cat.type];
            const finalMult =
              tariff?.final_tariff_multiplier ?? baseSurgeMultiplier * cat.defaultMultiplier;
            const vehicleMult = tariff?.vehicle_multiplier ?? cat.defaultMultiplier;
            const avgPower = tariff?.avg_power_kw ?? cat.defaultKw;
            const label = tariff?.vehicle_label ?? cat.fallbackLabel;

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
                        boxShadow:
                          '0 0 30px rgba(244, 63, 94, 0.4), 0 0 15px rgba(245, 158, 11, 0.3)',
                        borderColor: 'rgba(244, 63, 94, 0.85)',
                      }
                    : undefined
                }
                className={`relative rounded-2xl p-6 backdrop-blur-xl bg-glass-fill border transition-all duration-300 flex flex-col justify-between overflow-hidden h-full ${
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

                  {/* Reserved title area for alignment across cards */}
                  <div className="min-h-[3.25rem] mb-1 flex items-start">
                    <h2 className="font-headline-md text-headline-md text-text-primary">
                      {label}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2 font-label-mono text-xs text-text-secondary mb-4">
                    <Gauge className="w-3.5 h-3.5 text-text-secondary" />
                    <span>
                      Avg Draw: <strong className="text-text-primary">{avgPower.toFixed(1)} kW</strong>
                    </span>
                  </div>
                </div>

                {/* Multiplier Hero Display (anchored to bottom via mt-auto) */}
                <div className="mt-auto p-4 rounded-xl bg-surface-container-lowest/50 border border-border-subtle/80 flex flex-col">
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
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Row 2: Estimator (~7 cols) next to Curve Chart (~5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gap-grid items-stretch">
        {/* Session Cost Estimator Tile */}
        <div className="lg:col-span-7 flex flex-col">
          <Tile index={1} className="h-full flex flex-col justify-between p-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                    <Calculator className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-headline-md text-headline-md text-text-primary">
                      Session Cost Estimator
                    </h2>
                    <p className="text-xs font-label-mono text-text-secondary">
                      Instant driver billing estimation under current grid tariff
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-label-mono text-text-secondary bg-surface-variant/40 border border-border-subtle uppercase">
                  Live Calculator
                </span>
              </div>

              {/* Vehicle Category Selector */}
              <div className="mb-4">
                <label className="block text-xs font-label-mono text-text-secondary mb-2">
                  Vehicle Category
                </label>
                <div
                  role="radiogroup"
                  aria-label="Vehicle Category"
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                >
                  {CATEGORIES.map((cat) => {
                    const isSelected = selectedCategory === cat.type;
                    return (
                      <button
                        key={cat.type}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => handleCategoryChange(cat.type)}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-label-mono transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${
                          isSelected
                            ? `${cat.badgeBg} ${cat.badgeBorder} ${cat.accentColor} font-bold shadow-sm`
                            : 'bg-surface-container-lowest/60 border-border-subtle/70 text-text-secondary hover:text-text-primary hover:border-border-subtle'
                        }`}
                      >
                        <cat.Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">
                          {cat.type === 'two_wheeler'
                            ? 'Two-Wheeler'
                            : cat.type === 'standard_4w'
                            ? 'Standard 4W'
                            : 'Fast Charging'}
                        </span>
                        <span className="ml-auto text-[10px] opacity-80">
                          {cat.defaultMultiplier.toFixed(2)}x
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Numerical Inputs: Energy Needed & Base Rate */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="estimator-energy-kwh"
                      className="text-xs font-label-mono text-text-secondary"
                    >
                      Energy Needed (kWh)
                    </label>
                    <span className="text-[10px] font-label-mono text-text-tertiary">
                      Default: {CATEGORY_DEFAULTS[selectedCategory].energyKwh} kWh
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      id="estimator-energy-kwh"
                      type="number"
                      min={1}
                      max={150}
                      step={1}
                      value={energyKwh || ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setEnergyKwh(isNaN(val) ? 0 : val);
                      }}
                      className="w-full bg-surface-container-lowest/80 border border-border-subtle rounded-lg px-3 py-2 text-sm font-label-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                      aria-label="Energy Needed in kilowatt-hours"
                    />
                    <span className="absolute right-3 top-2.5 text-xs font-label-mono text-text-secondary pointer-events-none">
                      kWh
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="estimator-base-rate"
                      className="text-xs font-label-mono text-text-secondary"
                    >
                      Illustrative base rate
                    </label>
                    <span className="text-[10px] font-label-mono text-text-tertiary">
                      Standard: ₹12.00
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      id="estimator-base-rate"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={baseRate || ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setBaseRate(isNaN(val) ? 0 : val);
                      }}
                      className="w-full bg-surface-container-lowest/80 border border-border-subtle rounded-lg px-3 py-2 text-sm font-label-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                      aria-label="Illustrative base rate in rupees per kilowatt-hour"
                    />
                    <span className="absolute right-3 top-2.5 text-xs font-label-mono text-text-secondary pointer-events-none">
                      ₹/kWh
                    </span>
                  </div>
                </div>
              </div>

              {/* Calculated Outputs Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-surface-container-lowest/50 border border-border-subtle/80 mb-4">
                <div className="flex flex-col">
                  <span className="text-[11px] font-label-mono uppercase tracking-wider text-text-secondary">
                    Est. Duration
                  </span>
                  <span className="text-lg font-bold font-label-mono text-text-primary mt-1">
                    {estimate.durationFormatted}
                  </span>
                  <span className="text-[10px] font-label-mono text-text-tertiary">
                    at {activeAvgPower.toFixed(1)} kW
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[11px] font-label-mono uppercase tracking-wider text-text-secondary">
                    Cost Now
                  </span>
                  <span className="text-lg font-bold font-label-mono text-primary mt-1">
                    ₹{formatRupees(estimate.costNow)}
                  </span>
                  <span className="text-[10px] font-label-mono text-text-tertiary">
                    at {activeEffectiveMultiplier.toFixed(2)}x rate
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[11px] font-label-mono uppercase tracking-wider text-text-secondary">
                    Cost at 1.00x
                  </span>
                  <span className="text-lg font-bold font-label-mono text-text-secondary mt-1">
                    ₹{formatRupees(estimate.costNominal)}
                  </span>
                  <span className="text-[10px] font-label-mono text-text-tertiary">
                    nominal tariff
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[11px] font-label-mono uppercase tracking-wider text-text-secondary">
                    Difference
                  </span>
                  <span
                    className={`text-lg font-bold font-label-mono mt-1 ${
                      estimate.diff > 0
                        ? 'text-status-critical'
                        : estimate.diff < 0
                        ? 'text-emerald-400'
                        : 'text-text-primary'
                    }`}
                  >
                    {estimate.diffFormatted}
                  </span>
                  <span className="text-[10px] font-label-mono text-text-tertiary">
                    vs nominal
                  </span>
                </div>
              </div>
            </div>

            {/* One-line Summary Box */}
            <div className="p-3 rounded-lg bg-surface-container-lowest/70 border border-border-subtle/80 text-xs font-label-mono text-text-secondary flex items-start gap-2">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-text-primary leading-relaxed">{estimate.summaryText}</p>
            </div>
          </Tile>
        </div>

        {/* Multiplier vs. Grid Load Curve Tile */}
        <div className="lg:col-span-5 flex flex-col">
          <Tile index={2} className="h-full flex flex-col justify-between p-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-headline-md text-headline-md text-text-primary">
                      Tariff Multiplier vs. Grid Load
                    </h2>
                    <p className="text-xs font-label-mono text-text-secondary">
                      Policy curve from 0% to 100% capacity utilization
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-label-mono text-text-secondary bg-surface-variant/40 border border-border-subtle uppercase">
                  Policy Curve
                </span>
              </div>

              {/* Utilization Indicator Note */}
              <div className="flex items-center justify-between text-xs font-label-mono text-text-secondary mb-3">
                <span>Station Load Response</span>
                <span>
                  Current: <strong className="text-primary font-bold">{currentCapacityUtilizationPct.toFixed(1)}%</strong>
                </span>
              </div>

              {/* Step Chart */}
              <div
                role="region"
                aria-label="Tariff Multiplier vs Grid Load step chart showing dynamic rate multipliers across 0 to 100 percent station utilization"
                tabIndex={0}
                className="w-full h-56 focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={curvePoints}
                    margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid
                      stroke="rgba(255, 255, 255, 0.07)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="utilization_pct"
                      unit="%"
                      stroke="var(--color-text-secondary, #94a3b8)"
                      tick={{
                        fill: 'var(--color-text-secondary, #94a3b8)',
                        fontSize: 10,
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                      domain={[0, 100]}
                    />
                    <YAxis
                      unit="x"
                      domain={[0.6, 2.6]}
                      stroke="var(--color-text-secondary, #94a3b8)"
                      tick={{
                        fill: 'var(--color-text-secondary, #94a3b8)',
                        fontSize: 10,
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                    <Tooltip content={<CurveTooltip />} />
                    <Legend
                      wrapperStyle={{
                        paddingTop: '6px',
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                    <ReferenceLine
                      x={referenceLineX}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      label={{
                        value: `${currentCapacityUtilizationPct.toFixed(0)}%`,
                        fill: '#ef4444',
                        fontSize: 10,
                        position: 'insideTopRight',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="two_wheeler"
                      name="2-Wheeler (0.85x)"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="standard_4w"
                      name="Standard 4W (1.00x)"
                      stroke="#8aebff"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="fast_charging"
                      name="Fast (1.35x)"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Threshold Bands Footer */}
            <div className="grid grid-cols-4 gap-1.5 pt-3 border-t border-border-subtle/50 text-[10px] font-label-mono text-center mt-3">
              <div className="p-1 rounded bg-surface-container-lowest/50 text-text-secondary">
                <div className="text-emerald-400 font-bold">&lt;65%</div>
                <div>Normal 1.0x</div>
              </div>
              <div className="p-1 rounded bg-surface-container-lowest/50 text-text-secondary">
                <div className="text-status-warning font-bold">65-80%</div>
                <div>Warn 1.2x</div>
              </div>
              <div className="p-1 rounded bg-surface-container-lowest/50 text-text-secondary">
                <div className="text-status-critical font-bold">80-95%</div>
                <div>Crit 1.45x</div>
              </div>
              <div className="p-1 rounded bg-surface-container-lowest/50 text-text-secondary">
                <div className="text-status-critical font-bold">&ge;95%</div>
                <div>Sev 1.8x</div>
              </div>
            </div>
          </Tile>
        </div>
      </div>

      {/* Row 3: Auto-generated Comparison Sentence Callout Tile */}
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
