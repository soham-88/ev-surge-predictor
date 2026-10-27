import { useState } from 'react';
import { StressSandbox } from '../components/Dashboard/StressSandbox';
import { StallGrid } from '../components/Dashboard/StallGrid';
import { useData } from '../context/DataContext';
import { useTariff } from '../context/TariffContext';
import { useToast } from '../context/ToastContext';
import { Skeleton, SkeletonText, ErrorState } from '../components/ui';

function SandboxSkeleton() {
  return (
    <div className="flex flex-col gap-gap-grid">
      {/* Stress Sandbox Skeleton */}
      <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col gap-6">
        <div className="flex items-center gap-3 border-b border-border-subtle/40 pb-4">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <SkeletonText className="w-56 h-7" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 my-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="flex justify-between">
                <SkeletonText className="w-28 h-4" />
                <SkeletonText className="w-12 h-4" />
              </div>
              <Skeleton className="w-full h-3 rounded-full my-2" />
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center pt-4 border-t border-border-subtle/40">
          <SkeletonText className="w-48 h-4" />
          <Skeleton className="w-36 h-10 rounded-lg" />
        </div>
      </div>

      {/* Stall Grid Skeleton */}
      <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col gap-6">
        <div className="flex justify-between items-center border-b border-border-subtle/40 pb-4">
          <SkeletonText className="w-48 h-7" />
          <Skeleton className="w-24 h-6 rounded-full" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3 my-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SandboxPage() {
  const {
    predictData,
    simulateData,
    bayStates,
    handleSimulate,
    isSimulationMode,
    activeSimulationParams,
    resetSimulation,
    isLoading,
    isRetrying,
    hasError,
    errorMessage,
    retryLoad,
  } = useData();
  const { setSimulationTariff, resetToLive } = useTariff();
  const toast = useToast();
  const [isApplying, setIsApplying] = useState(false);

  if (isLoading) {
    return <SandboxSkeleton />;
  }

  if ((hasError || !predictData || !simulateData) && !isLoading) {
    return (
      <div className="py-12 max-w-2xl mx-auto">
        <ErrorState
          title="Sandbox Engine Offline"
          message={errorMessage || 'Unable to connect to the simulation engine. Please ensure the backend is running.'}
          onRetry={retryLoad}
          isRetrying={isRetrying}
        />
      </div>
    );
  }

  if (!predictData || !simulateData) return null;

  const handleApplySimulation = async (params: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  }) => {
    setIsApplying(true);
    try {
      const res = await handleSimulate(params);
      const multiplier = (res && 'dispatched_mitigations' in res)
        ? res.dispatched_mitigations.dynamic_tariff_multiplier
        : simulateData.dispatched_mitigations.dynamic_tariff_multiplier;
      setSimulationTariff(multiplier, {
        tempDelta: params.temp_delta_c,
        trafficSurgePct: params.traffic_surge_pct,
        outageStalls: params.forced_outage_stalls.length,
      });
      toast.success('Simulation applied successfully! Dynamic mitigation dispatched.');
    } catch (err) {
      toast.error('Simulation failed. Could not compute stressed scenario.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleResetToLive = async () => {
    await resetSimulation();
    const liveMultiplier = predictData.recommended_actions.dynamic_tariff_multiplier;
    resetToLive(liveMultiplier);
    toast.info('Reset to live operating conditions.');
  };

  return (
    <>
      <div className="flex flex-col gap-gap-grid">
        {isSimulationMode && (
          <div className="bg-status-warning/20 border border-status-warning/50 rounded-lg p-4 flex justify-between items-center shadow-lg">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-status-warning">warning</span>
              <span className="font-label-mono text-status-warning font-bold">
                SIMULATION ACTIVE — showing hypothetical, not live, data
              </span>
            </div>
            <button
              onClick={handleResetToLive}
              className="px-4 py-1.5 rounded bg-status-warning/20 border border-status-warning text-status-warning font-label-mono font-bold hover:bg-status-warning/30 transition-colors cursor-pointer"
            >
              Reset to Live
            </button>
          </div>
        )}

        {/* Full-width Stress Sandbox */}
        <StressSandbox 
          onSimulate={handleApplySimulation} 
          isSimulationMode={isSimulationMode}
          baselineKw={predictData.predicted_load_kw}
          simulatedKw={simulateData.simulated_peak_kw}
          isApplying={isApplying}
        />

        {/* Full-width Stall Matrix */}
        <StallGrid
          activePlugs={7}
          throttledStalls={simulateData.dispatched_mitigations.throttled_stalls}
          shedStalls={isSimulationMode && activeSimulationParams ? activeSimulationParams.forced_outage_stalls : predictData.recommended_actions.shed_stalls}
          perStallCapKw={predictData.recommended_actions.per_stall_cap_kw}
          bayStates={bayStates}
        />
      </div>
    </>
  );
}
