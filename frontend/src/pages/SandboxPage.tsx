import { StressSandbox } from '../components/Dashboard/StressSandbox';
import { StallGrid } from '../components/Dashboard/StallGrid';
import { useData } from '../context/DataContext';
import { useTariff } from '../context/TariffContext';

export function SandboxPage() {
  const { predictData, simulateData, bayStates, handleSimulate, isSimulationMode, activeSimulationParams, resetSimulation } = useData();
  const { setSimulationTariff, resetToLive } = useTariff();

  if (!predictData || !simulateData) return null;

  const handleApplySimulation = async (params: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  }) => {
    const res = await handleSimulate(params);
    const multiplier = (res && 'dispatched_mitigations' in res)
      ? res.dispatched_mitigations.dynamic_tariff_multiplier
      : simulateData.dispatched_mitigations.dynamic_tariff_multiplier;
    setSimulationTariff(multiplier, {
      tempDelta: params.temp_delta_c,
      trafficSurgePct: params.traffic_surge_pct,
      outageStalls: params.forced_outage_stalls.length,
    });
  };

  const handleResetToLive = async () => {
    await resetSimulation();
    const liveMultiplier = predictData.recommended_actions.dynamic_tariff_multiplier;
    resetToLive(liveMultiplier);
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
