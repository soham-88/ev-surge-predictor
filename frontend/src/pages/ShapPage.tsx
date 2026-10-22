import { useState, useEffect, useCallback } from 'react';
import { ShapWaterfall } from '../components/Dashboard/ShapWaterfall';
import { ModelComparison } from '../components/Dashboard/ModelComparison';
import { useData } from '../context/DataContext';
import { useTariff } from '../context/TariffContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { ExplainResponse } from '../types/telemetry';

export function ShapPage() {
  const { explainData: contextExplainData } = useData();
  const { user } = useAuth();
  const { isSimulationActive, simulationParams } = useTariff();

  const [explainData, setExplainData] = useState<ExplainResponse | null>(contextExplainData);

  const fetchExplanation = useCallback(async () => {
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
    } catch (err) {
      console.warn('Failed to fetch explanation from API, using context fallback', err);
      if (contextExplainData) {
        setExplainData(contextExplainData);
      }
    }
  }, [isSimulationActive, simulationParams, contextExplainData]);

  useEffect(() => {
    fetchExplanation();

    // When NOT in simulation mode, refresh on the existing 5-minute interval
    if (!isSimulationActive) {
      const interval = setInterval(fetchExplanation, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [fetchExplanation, isSimulationActive]);

  const activeExplainData = explainData || contextExplainData;
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
