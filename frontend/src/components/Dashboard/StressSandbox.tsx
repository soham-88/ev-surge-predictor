import { Tile } from '../ui/Tile';
import { StyledSlider } from '../ui/StyledSlider';
import { useTariff } from '../../context/TariffContext';

interface Props {
  onSimulate: (params: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  }) => void;
  isSimulationMode: boolean;
  baselineKw: number;
  simulatedKw: number;
}

export function StressSandbox({ onSimulate, isSimulationMode, baselineKw, simulatedKw }: Props) {
  const { simulationParams, setTempDelta, setTrafficSurgePct, setOutageStalls } = useTariff();

  const handleApply = () => {
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
      <div className="flex justify-between items-center pt-4 border-t border-border-subtle">
        <div className="font-label-mono text-text-secondary flex gap-2 items-center">
          {isSimulationMode && (
            <>
              Baseline: <span className="text-text-primary font-bold">{baselineKw.toFixed(1)} kW</span> 
              <span className="material-symbols-outlined text-sm mx-1">arrow_forward</span> 
              Simulated: <span className="text-status-warning font-bold">{simulatedKw.toFixed(1)} kW</span>
            </>
          )}
        </div>
        <button 
          onClick={handleApply}
          className="px-6 py-2 rounded border border-primary/50 text-primary font-label-mono text-label-mono font-bold hover:bg-primary/10 transition-colors"
        >
          Apply Simulation
        </button>
      </div>
    </Tile>
  );
}
