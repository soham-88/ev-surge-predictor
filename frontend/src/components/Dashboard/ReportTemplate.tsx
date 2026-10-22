import React, { useEffect, useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { useTariff } from '../../context/TariffContext';
import { ForecastTimeline } from './ForecastTimeline';
import { ShapWaterfall } from './ShapWaterfall';
import { ModelComparison } from './ModelComparison';
import { Bike, Car, Zap } from 'lucide-react';

interface VehicleTariffData {
  vehicle_type: string;
  vehicle_label: string;
  avg_power_kw: number;
  base_surge_multiplier: number;
  vehicle_multiplier: number;
  final_tariff_multiplier: number;
}

// Forward ref to attach to the root element for html2canvas
export const ReportTemplate = React.forwardRef<HTMLDivElement>((_, ref) => {
  const { predictData, explainData, simulateData, recentEvents, isSimulationMode, bayStates } = useData();
  const { user } = useAuth();
  const { baseSurgeMultiplier, isSimulationActive } = useTariff();

  const [tariffs, setTariffs] = useState<Record<string, VehicleTariffData | null>>({
    two_wheeler: null,
    standard_4w: null,
    fast_charging: null,
  });

  const reportId = useMemo(() => {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `RPT-${datePart}-${timePart}`;
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const API_BASE = rawApiUrl.endsWith('/api/v1')
      ? rawApiUrl
      : `${rawApiUrl.replace(/\/+$/, '')}/api/v1`;

    const fetchCategory = async (type: string): Promise<VehicleTariffData | null> => {
      try {
        const res = await fetch(`${API_BASE}/tariff/vehicle-adjusted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base_surge_multiplier: baseSurgeMultiplier,
            vehicle_type: type,
          }),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    Promise.all([
      fetchCategory('two_wheeler'),
      fetchCategory('standard_4w'),
      fetchCategory('fast_charging'),
    ]).then(([twoW, std4w, fastC]) => {
      if (!isCancelled) {
        setTariffs({
          two_wheeler: twoW,
          standard_4w: std4w,
          fast_charging: fastC,
        });
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [baseSurgeMultiplier]);

  if (!predictData || !explainData || !simulateData) return null;

  const displayCapacityPct = (simulateData.simulated_peak_kw / predictData.transformer_capacity_kw) * 100;
  const displaySurgeStatus = simulateData.surge_risk;

  // Comparison sentence computation matching Vehicle Tariff Lab
  const fcData = tariffs.fast_charging;
  const stdData = tariffs.standard_4w;
  let comparisonSentence = '';
  if (fcData && stdData && stdData.final_tariff_multiplier > 0) {
    const fcMultiplier = fcData.final_tariff_multiplier;
    const stdMultiplier = stdData.final_tariff_multiplier;
    const diffPct = ((fcMultiplier - stdMultiplier) / stdMultiplier) * 100;
    comparisonSentence = `Fast-Charging EVs pay ${fcMultiplier.toFixed(2)}x base rate — ${diffPct.toFixed(1)}% more than Standard 4W EVs, due to higher instantaneous load contribution.`;
  } else {
    const fcMult = (baseSurgeMultiplier * 1.35).toFixed(2);
    comparisonSentence = `Fast-Charging EVs pay ${fcMult}x base rate — 35.0% more than Standard 4W EVs, due to higher instantaneous load contribution.`;
  }

  // 1. Bay Status Matrix section inserted immediately after Mitigation Actions and before Recent Surge Events
  const bayStatusMatrixSection = (
    <div className="col-span-12 rounded-2xl p-6 backdrop-blur-xl bg-glass-fill border border-border-subtle flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-xl">ev_station</span>
          <h3 className="font-headline-md text-headline-md text-text-primary">Bay Status Matrix</h3>
        </div>
        <div className="flex items-center gap-4 text-xs font-label-mono text-text-secondary">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> Active</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-status-warning" /> Throttled</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-status-critical" /> Shed</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-outline/50" /> Idle</span>
        </div>
      </div>

      <div className="grid grid-cols-8 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(stallNum => {
          const bay = bayStates?.[stallNum] || { state: 'IDLE', kwDraw: 0.0 };
          const paddedNum = stallNum.toString().padStart(2, '0');

          let textClass = 'text-text-secondary';
          let bgClass = 'bg-surface-variant/20';
          let borderClass = 'border-border-subtle';
          let dotClass = 'bg-outline/50';

          if (bay.state === 'ACTIVE') {
            textClass = 'text-primary';
            bgClass = 'bg-primary/10';
            borderClass = 'border-primary/30';
            dotClass = 'bg-primary';
          } else if (bay.state === 'THROTTLED') {
            textClass = 'text-status-warning';
            bgClass = 'bg-status-warning/10';
            borderClass = 'border-status-warning/30';
            dotClass = 'bg-status-warning';
          } else if (bay.state === 'SHED') {
            textClass = 'text-status-critical';
            bgClass = 'bg-status-critical/10';
            borderClass = 'border-status-critical/30';
            dotClass = 'bg-status-critical';
          }

          return (
            <div 
              key={stallNum}
              className={`p-3 rounded-xl border ${borderClass} ${bgClass} flex flex-col items-center justify-between min-h-28 text-center`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-label-mono text-[11px] text-text-secondary">
                  BAY {paddedNum}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
              </div>
              <div className="my-1">
                <span className={`font-label-mono text-xs font-bold uppercase tracking-wider ${textClass}`}>
                  {bay.state}
                </span>
              </div>
              <div className="font-kpi-large text-base font-bold text-text-primary tabular-nums">
                {bay.kwDraw.toFixed(1)} <span className="text-[10px] text-text-secondary font-label-mono font-normal">kW</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div 
      ref={ref} 
      className="bg-background text-text-primary flex flex-col gap-6"
      style={{
        position: 'absolute',
        top: '-9999px',
        left: '-9999px',
        width: '1200px', // Fixed A4-like width
        padding: '40px',
        fontFamily: 'Inter, sans-serif'
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-end border-b border-border-subtle pb-6">
        <div>
          <h1 className="text-4xl font-headline-xl font-bold mb-2">EV Surge Predictor Report</h1>
          <p className="text-text-secondary font-label-mono tracking-widest uppercase">
            System Snapshot
          </p>
        </div>
        <div className="text-right">
          <div className="font-label-mono text-sm text-text-secondary mb-1">
            Date: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}
          </div>
          <div className={`font-label-mono text-sm font-bold tracking-widest uppercase px-3 py-1 rounded inline-block ${
            isSimulationMode ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-status-normal/20 text-status-normal border border-status-normal/30'
          }`}>
            MODE: {isSimulationMode ? 'SIMULATED' : 'LIVE'}
          </div>
        </div>
      </div>

      {/* System Overview (Chart & KPIs with Bay Status Matrix inserted) */}
      <div className="mt-4 grid grid-cols-12 gap-4 auto-rows-min">
        <ForecastTimeline 
          data={simulateData.timeline}
          capacityPct={displayCapacityPct}
          surgeStatus={displaySurgeStatus}
          tariffMultiplier={simulateData.dispatched_mitigations.dynamic_tariff_multiplier}
          predictedLoadKw={predictData.predicted_load_kw}
          transformerCapacityKw={predictData.transformer_capacity_kw}
          recommendedActions={predictData.recommended_actions}
          recentEvents={recentEvents}
          isSimulated={isSimulationMode}
          isReport={true}
          bayMatrixSection={bayStatusMatrixSection}
        />
      </div>

      {/* SHAP Waterfall */}
      <div className="mt-8" style={{ height: '400px' }}>
        <ShapWaterfall 
          baseValue={explainData.base_value_kw}
          predictedValue={explainData.predicted_value_kw}
          attributions={explainData.attributions}
        />
      </div>

      {/* 2. Vehicle Tariff Lab section inserted immediately after Live SHAP Waterfall and before Model Comparison */}
      <div className="mt-8 rounded-2xl p-6 backdrop-blur-xl bg-glass-fill border border-border-subtle flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-2xl">electric_car</span>
            <div>
              <h2 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">
                Vehicle Tariff Lab
              </h2>
              <p className="font-body-md text-xs text-text-secondary">
                Category-calibrated dynamic pricing adjusted for vehicle power draw and peak surge impact
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-surface-variant/40 border border-border-subtle font-label-mono text-xs">
              <span className="text-text-secondary uppercase">Base Surge</span>
              <strong className="text-text-primary font-bold">x{baseSurgeMultiplier.toFixed(2)}</strong>
            </div>

            {isSimulationActive ? (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-status-warning/10 border border-status-warning/40 text-status-warning font-label-mono text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-status-warning"></span>
                SIMULATION ACTIVE
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/40 text-primary font-label-mono text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-primary"></span>
                LIVE
              </div>
            )}
          </div>
        </div>

        {/* 3 Vehicle Tiers */}
        <div className="grid grid-cols-3 gap-4">
          {/* Tier 1: Two-Wheeler */}
          {(() => {
            const data = tariffs.two_wheeler;
            const avgPower = data?.avg_power_kw ?? 1.2;
            const catMultiplier = data?.vehicle_multiplier ?? 0.85;
            const effectiveMultiplier = data?.final_tariff_multiplier ?? (baseSurgeMultiplier * catMultiplier);
            const label = data?.vehicle_label ?? 'Two-Wheeler EV (e.g., Ola S1)';

            return (
              <div className="rounded-xl p-5 bg-surface-container-lowest/50 border border-border-subtle flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2.5 rounded-xl border bg-secondary/15 text-secondary border-secondary/30">
                      <Bike className="w-5 h-5" />
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-label-mono bg-surface-variant/40 text-text-secondary border border-border-subtle uppercase tracking-wider">
                      Tier 1
                    </span>
                  </div>
                  <h3 className="font-headline-md text-text-primary font-bold text-base mb-1">{label}</h3>
                  <div className="font-label-mono text-xs text-text-secondary mb-4">
                    Avg Draw: <strong className="text-text-primary">{avgPower.toFixed(1)} kW</strong>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface-variant/20 border border-border-subtle/60 flex flex-col gap-2">
                  <span className="font-label-mono text-[10px] text-text-secondary uppercase tracking-widest">
                    Effective Tariff Multiplier
                  </span>
                  <div className="text-2xl font-bold font-label-mono text-secondary tabular-nums">
                    {effectiveMultiplier.toFixed(2)}x
                  </div>
                  <div className="pt-2 border-t border-border-subtle/50 flex justify-between text-[11px] font-label-mono text-text-secondary">
                    <span>Category Multiplier:</span>
                    <strong className="text-text-primary">{catMultiplier.toFixed(2)}x</strong>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Tier 2: Standard 4W */}
          {(() => {
            const data = tariffs.standard_4w;
            const avgPower = data?.avg_power_kw ?? 7.2;
            const catMultiplier = data?.vehicle_multiplier ?? 1.00;
            const effectiveMultiplier = data?.final_tariff_multiplier ?? (baseSurgeMultiplier * catMultiplier);
            const label = data?.vehicle_label ?? 'Standard 4W EV (e.g., Tata Nexon EV)';

            return (
              <div className="rounded-xl p-5 bg-surface-container-lowest/50 border border-border-subtle flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2.5 rounded-xl border bg-primary/15 text-primary border-primary/30">
                      <Car className="w-5 h-5" />
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-label-mono bg-surface-variant/40 text-text-secondary border border-border-subtle uppercase tracking-wider">
                      Tier 2
                    </span>
                  </div>
                  <h3 className="font-headline-md text-text-primary font-bold text-base mb-1">{label}</h3>
                  <div className="font-label-mono text-xs text-text-secondary mb-4">
                    Avg Draw: <strong className="text-text-primary">{avgPower.toFixed(1)} kW</strong>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface-variant/20 border border-border-subtle/60 flex flex-col gap-2">
                  <span className="font-label-mono text-[10px] text-text-secondary uppercase tracking-widest">
                    Effective Tariff Multiplier
                  </span>
                  <div className="text-2xl font-bold font-label-mono text-primary tabular-nums">
                    {effectiveMultiplier.toFixed(2)}x
                  </div>
                  <div className="pt-2 border-t border-border-subtle/50 flex justify-between text-[11px] font-label-mono text-text-secondary">
                    <span>Category Multiplier:</span>
                    <strong className="text-text-primary">{catMultiplier.toFixed(2)}x</strong>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Tier 3: Fast-Charging */}
          {(() => {
            const data = tariffs.fast_charging;
            const avgPower = data?.avg_power_kw ?? 45.0;
            const catMultiplier = data?.vehicle_multiplier ?? 1.35;
            const effectiveMultiplier = data?.final_tariff_multiplier ?? (baseSurgeMultiplier * catMultiplier);
            const label = data?.vehicle_label ?? 'Fast-Charging EV (e.g., MG ZS EV DC)';

            return (
              <div className="rounded-xl p-5 bg-surface-container-lowest/50 border border-border-subtle flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2.5 rounded-xl border bg-status-warning/15 text-status-warning border-status-warning/30">
                      <Zap className="w-5 h-5" />
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-label-mono bg-status-warning/20 text-status-warning border border-status-warning/30 uppercase tracking-wider">
                      Tier 3
                    </span>
                  </div>
                  <h3 className="font-headline-md text-text-primary font-bold text-base mb-1">{label}</h3>
                  <div className="font-label-mono text-xs text-text-secondary mb-4">
                    Avg Draw: <strong className="text-text-primary">{avgPower.toFixed(1)} kW</strong>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface-variant/20 border border-border-subtle/60 flex flex-col gap-2">
                  <span className="font-label-mono text-[10px] text-text-secondary uppercase tracking-widest">
                    Effective Tariff Multiplier
                  </span>
                  <div className="text-2xl font-bold font-label-mono text-status-warning tabular-nums">
                    {effectiveMultiplier.toFixed(2)}x
                  </div>
                  <div className="pt-2 border-t border-border-subtle/50 flex justify-between text-[11px] font-label-mono text-text-secondary">
                    <span>Category Multiplier:</span>
                    <strong className="text-text-primary">{catMultiplier.toFixed(2)}x</strong>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Dynamic Comparison Sentence */}
        <div className="p-4 rounded-xl bg-surface-container-lowest/60 border border-border-subtle flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-xl shrink-0">info</span>
          <p className="font-body-md text-sm text-text-primary">
            At current grid conditions, {comparisonSentence}
          </p>
        </div>
      </div>

      {/* Model Comparison */}
      <div className="mt-8">
        <ModelComparison attributions={explainData.attributions} />
      </div>
      
      {/* Footer */}
      <div className="mt-12 pt-6 border-t border-border-subtle flex justify-between items-center text-text-secondary font-label-mono text-xs">
        <div>
          Generated by EV Charging Surge Predictor • Confidential
        </div>
        <div className="flex items-center gap-4 text-right">
          <span>
            OPERATOR: <strong className="text-text-primary">{user ? `${user.name} (${user.role})` : 'System Operator (Operator)'}</strong>
          </span>
          <span className="opacity-40">•</span>
          <span>
            REPORT ID: <strong className="text-text-primary">{reportId}</strong>
          </span>
        </div>
      </div>
    </div>
  );
});

ReportTemplate.displayName = 'ReportTemplate';
