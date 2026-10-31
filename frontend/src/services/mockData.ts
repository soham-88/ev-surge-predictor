import type { PredictResponse, ExplainResponse, SimulateResponse } from '../types/telemetry';

export const mockPredictResponse: PredictResponse = {
  predicted_load_kw: 224.6,
  transformer_capacity_kw: 250.0,
  capacity_utilization_pct: 89.84,
  surge_status: 'CRITICAL',
  recommended_actions: {
    dynamic_tariff_multiplier: 1.45,
    throttle_active: true,
    per_stall_cap_kw: 60.0,
    shed_stalls: [4, 7],
  },
  inference_latency_ms: 0.48,
};

export const mockExplainResponse: ExplainResponse = {
  base_value_kw: 120.0,
  predicted_value_kw: 224.6,
  attributions: [
    { feature: 'ambient_temp_c', value: 36.5, shap_delta_kw: 42.1 },
    { feature: 'traffic_inflow_index', value: 82, shap_delta_kw: 31.5 },
    { feature: 'load_lag_15m', value: 192.0, shap_delta_kw: 24.2 },
    { feature: 'grid_frequency_hz', value: 49.92, shap_delta_kw: 6.8 },
  ],
};

export const mockSimulateResponse: SimulateResponse = {
  simulation_id: 'sim_98234',
  baseline_peak_kw: 185.0,
  simulated_peak_kw: 238.4,
  peak_time_delta_min: 120,
  surge_risk: 'CRITICAL',
    timeline: [
    { timestamp: '2026-08-25T14:00:00Z', baseline_kw: 140, simulated_kw: 140 },
    { timestamp: '2026-08-25T15:00:00Z', baseline_kw: 165, simulated_kw: 195 },
    { timestamp: '2026-08-25T16:00:00Z', baseline_kw: 185, simulated_kw: 238 },
  ],
  dispatched_mitigations: {
    dynamic_tariff_multiplier: 1.6,
    throttled_stalls: [1, 3, 4],
  },
};
