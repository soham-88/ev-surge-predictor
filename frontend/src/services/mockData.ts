import type { PredictResponse, ExplainResponse, SimulateResponse, MetricsResponse } from '../types/telemetry';

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
  inference_latency_ms: 1.15,
  lower_bound_kw: 201.6,
  upper_bound_kw: 245.6,
};

export const mockExplainResponse: ExplainResponse = {
  base_value_kw: 105.56,
  predicted_value_kw: 224.6,
  attributions: [
    { feature: 'load_lag_15m', value: 192.0, shap_delta_kw: 38.4 },
    { feature: 'lag_trend', value: 25.0, shap_delta_kw: 24.2 },
    { feature: 'hour_cos', value: 0.5, shap_delta_kw: 22.5 },
    { feature: 'traffic_inflow_index', value: 82, shap_delta_kw: 18.2 },
    { feature: 'load_anomaly', value: 33.8, shap_delta_kw: 14.5 },
    { feature: 'ambient_temp_c', value: 36.5, shap_delta_kw: 3.24 },
    { feature: 'grid_frequency_hz', value: 49.92, shap_delta_kw: -2.0 },
  ],
};

export const mockMetricsResponse: MetricsResponse = {
  models: [
    {
      name: 'XGBoost Regressor (Primary)',
      mae_kw: 12.67,
      rmse_kw: 15.93,
      surge_recall_pct: 81.9,
      latency_ms: 6.3,
      rule_a_recall_pct: 81.9,
      early_warning_recall_pct: 99.6,
      rule_a_precision_pct: 84.7,
      latency_model_only_ms: 1.15,
      latency_end_to_end_ms: 6.3,
      n_test_samples: 9210,
    },
    {
      name: 'PyTorch LSTM Sequence (Benchmark)',
      mae_kw: 12.94,
      rmse_kw: 16.32,
      surge_recall_pct: 78.8,
      latency_ms: 0.44,
      rule_a_recall_pct: 78.8,
      early_warning_recall_pct: 99.7,
      rule_a_precision_pct: 86.4,
      latency_model_only_ms: 0.2,
      latency_end_to_end_ms: 0.44,
      n_test_samples: 9210,
    },
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
