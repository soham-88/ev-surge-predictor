import { Tile } from '../ui/Tile';
import { StyledSlider } from '../ui/StyledSlider';
import { useTariff } from '../../context/TariffContext';

interface Props {
  onSimulate: (params: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  }) => void | Promise<void>;
  isSimulationMode: boolean;
  baselineKw: number;
  simulatedKw: number;
  isApplying?: boolean;
}

export function StressSandbox({
  onSimulate,
  isSimulationMode,
  baselineKw,
  simulatedKw,
  isApplying = false,
}: Props) {
  const { simulationParams, setTempDelta, setTrafficSurgePct, setOutageStalls } = useTariff();

  const handleApply = () => {
    if (isApplying) return;
    onSimulate({
      temp_delta_c: simulationParams.tempDelta,
      traffic_surge_pct: simulationParams.trafficSurgePct,
      forced_outage_stalls: Array.from({ length: simulationParams.outageStalls }, (_, i) => i + 1),
    });
  };

  return (
    <Tile index={0} className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
        <span className="material-symbols-outlined text-primary">tune</span>
        <h2 className="font-headline-md text-headline-md text-text-primary">
          What-If Stress Sandbox
        </h2>
      </div>

      {/* Slider grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <StyledSlider
          label="Temperature Δ"
          value={simulationParams.tempDelta}
          min={0}
          max={15}
          step={1}
          unit="°C"
          prefix={simulationParams.tempDelta > 0 ? '+' : ''}
          onChange={setTempDelta}
        />
        <StyledSlider
          label="Traffic Surge"
          value={simulationParams.trafficSurgePct}
          min={0}
          max={100}
          step={5}
          unit="%"
          prefix="+"
          onChange={setTrafficSurgePct}
        />
        <StyledSlider
          label="Forced Outage Stalls"
          value={simulationParams.outageStalls}
          min={0}
          max={8}
          step={1}
          unit=" bays"
          onChange={setOutageStalls}
        />
      </div>
      
      {/* Footer / Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-4 border-t border-border-subtle">
        <div className="font-label-mono text-text-secondary flex flex-wrap gap-2 items-center text-xs">
          {isSimulationMode && (
            <>
              Baseline: <span className="text-text-primary font-bold">{baselineKw.toFixed(1)} kW</span> 
              <span className="material-symbols-outlined text-sm mx-1" aria-hidden="true">arrow_forward</span> 
              Simulated: <span className="text-status-warning font-bold">{simulatedKw.toFixed(1)} kW</span>
            </>
          )}
        </div>
        <button 
          onClick={handleApply}
          disabled={isApplying}
          aria-label="Apply simulation parameters"
          className="w-full sm:w-auto px-6 py-2.5 min-h-[44px] rounded border border-primary/50 text-primary font-label-mono text-xs font-bold hover:bg-primary/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {isApplying ? (
            <>
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>APPLYING...</span>
            </>
          ) : (
            <span>Apply Simulation</span>
          )}
        </button>
      </div>
    </Tile>
  );
}
