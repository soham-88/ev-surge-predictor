import { useState, useEffect, useCallback } from 'react';
import { ShapWaterfall } from '../components/Dashboard/ShapWaterfall';
import { ModelComparison } from '../components/Dashboard/ModelComparison';
import { useData } from '../context/DataContext';
import { useTariff } from '../context/TariffContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { ExplainResponse } from '../types/telemetry';
import { Skeleton, SkeletonText, ErrorState } from '../components/ui';

function ShapSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-gap-grid auto-rows-min">
      {/* 12-col Waterfall Chart Skeleton */}
      <div className="col-span-12 rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col min-h-[420px] justify-between">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <SkeletonText className="w-56 h-6" />
            <SkeletonText className="w-40 h-4" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="w-28 h-8 rounded-lg" />
            <Skeleton className="w-32 h-8 rounded-lg" />
          </div>
        </div>

        {/* Shimmer Waterfall Bars */}
        <div className="flex flex-col gap-3 my-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <SkeletonText className="w-32 h-4 shrink-0" />
              <Skeleton className={`h-7 rounded ${i % 2 === 0 ? 'w-2/3 bg-status-critical/15' : 'w-1/2 bg-primary/15'}`} />
            </div>
          ))}
        </div>

        <div className="pt-4 border-t border-border-subtle/40 mt-2">
          <SkeletonText className="w-3/4 h-4" />
        </div>
      </div>

      {/* 12-col Model Comparison Skeleton */}
      <div className="col-span-12 rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col min-h-[260px] justify-between">
        <div className="flex justify-between items-start mb-6">
          <SkeletonText className="w-64 h-6" />
          <Skeleton className="w-24 h-6 rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function ShapPage() {
  const { explainData: contextExplainData } = useData();
  const { user } = useAuth();
  const { isSimulationActive, simulationParams } = useTariff();

  const [explainData, setExplainData] = useState<ExplainResponse | null>(contextExplainData);
  const [isLoading, setIsLoading] = useState<boolean>(!contextExplainData);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchExplanation = useCallback(async (isRetry = false) => {
    if (isRetry) {
      setIsRetrying(true);
    } else if (!explainData && !contextExplainData) {
      setIsLoading(true);
    }
    setHasError(false);
    setErrorMessage(null);

    try {
      if (isSimulationActive) {
        // Calculate simulated feature inputs
        const simAmbientTemp = 36.5 + (simulationParams.tempDelta || 0);
        const simTraffic = Math.min(
          100,
          Math.max(0, Math.round(82 * (1 + (simulationParams.trafficSurgePct || 0) / 100)))
        );
        const simPlugs = Math.min(8, Math.max(0, 7 - (simulationParams.outageStalls || 0)));

        const payload = {
          timestamp: new Date().toISOString(),
          ambient_temp_c: simAmbientTemp,
          traffic_inflow_index: simTraffic,
          active_plugs: simPlugs,
          grid_frequency_hz: 59.92,
          load_lags_kw: [142.0, 158.5, 175.0, 192.0],
        };

        const res = await api.explain(payload);
        setExplainData(res);
      } else {
        const res = await api.explain();
        setExplainData(res);
      }
      setHasError(false);
    } catch (err: any) {
      console.warn('Failed to fetch explanation from API', err);
      if (contextExplainData) {
        setExplainData(contextExplainData);
      } else {
        setHasError(true);
        setErrorMessage(
          err?.message === 'Unauthorized'
            ? 'Session expired. Please log in again.'
            : 'Unable to connect to the SHAP explanation service. The backend may be offline.'
        );
      }
    } finally {
      setIsLoading(false);
      setIsRetrying(false);
    }
  }, [isSimulationActive, simulationParams, contextExplainData, explainData]);

  useEffect(() => {
    fetchExplanation();

    // When NOT in simulation mode, refresh on the existing 5-minute interval
    if (!isSimulationActive) {
      const interval = setInterval(() => fetchExplanation(false), 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [fetchExplanation, isSimulationActive]);

  const activeExplainData = explainData || contextExplainData;

  if (isLoading && !activeExplainData) {
    return <ShapSkeleton />;
  }

  if ((hasError || !activeExplainData) && !isLoading) {
    return (
      <div className="py-12 max-w-2xl mx-auto">
        <ErrorState
          title="SHAP Engine Unavailable"
          message={errorMessage || 'Unable to load feature attributions and model explainability metrics.'}
          onRetry={() => fetchExplanation(true)}
          isRetrying={isRetrying}
        />
      </div>
    );
  }

  if (!activeExplainData) return null;

  return (
    <>
      {/* Simulation Active Banner */}
      {isSimulationActive && (
        <div className="mb-6 p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 flex items-center justify-between shadow-[0_0_15px_rgba(245,158,11,0.15)]">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-status-warning">science</span>
            <span className="font-body-md text-text-primary font-bold tracking-wide">
              SIMULATION ACTIVE — viewing TreeSHAP attributions for simulated stress parameters
            </span>
          </div>
          {user?.role === 'Operator' && (
            <Link 
              to="/sandbox" 
              className="font-label-mono text-sm text-status-warning hover:text-status-warning/80 underline transition-colors font-bold"
            >
              Back to Sandbox
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-gap-grid auto-rows-min">
        {/* Full-width SHAP Waterfall */}
        <ShapWaterfall
          baseValue={activeExplainData.base_value_kw}
          predictedValue={activeExplainData.predicted_value_kw}
          attributions={activeExplainData.attributions}
          isSimulationActive={isSimulationActive}
        />
        
        {/* Model Comparison */}
        <ModelComparison attributions={activeExplainData.attributions} />
      </div>
    </>
  );
}
