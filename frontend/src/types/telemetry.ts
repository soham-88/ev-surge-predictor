export interface RecommendedActions {
  dynamic_tariff_multiplier: number;
  throttle_active: boolean;
  per_stall_cap_kw: number;
  shed_stalls: number[];
}

export interface PredictResponse {
  predicted_load_kw: number;
  transformer_capacity_kw: number;
  capacity_utilization_pct: number;
  surge_status: 'NORMAL' | 'WARNING' | 'CRITICAL';
  recommended_actions: RecommendedActions;
  inference_latency_ms: number;
}

export interface Attribution {
  feature: string;
  value: number;
  shap_delta_kw: number;
}

export interface ExplainResponse {
  base_value_kw: number;
  predicted_value_kw: number;
  attributions: Attribution[];
}

export interface TimelinePoint {
  timestamp: string;
  baseline_kw: number;
  simulated_kw: number;
}

export interface DispatchedMitigations {
  dynamic_tariff_multiplier: number;
  throttled_stalls: number[];
}

export interface SimulateResponse {
  simulation_id: string;
  baseline_peak_kw: number;
  simulated_peak_kw: number;
  peak_time_delta_min: number;
  surge_risk: 'NORMAL' | 'WARNING' | 'CRITICAL';
  timeline: TimelinePoint[];
  dispatched_mitigations: DispatchedMitigations;
}

export interface ModelMetrics {
  name: string;
  mae_kw: number;
  rmse_kw: number;
  surge_recall_pct: number;
  latency_ms: number;
}

export interface MetricsResponse {
  models: ModelMetrics[];
}

export interface BatchSummary {
  peak_predicted_kw: number;
  peak_timestamp: string;
  critical_events_count: number;
  avg_mae_vs_actual_kw: number | null;
}

export interface BatchPrediction {
  timestamp: string;
  actual_kw: number | null;
  predicted_kw: number;
  surge_status: 'NORMAL' | 'WARNING' | 'CRITICAL';
}

export interface BatchPredictResponse {
  batch_id: string;
  rows_processed: number;
  rows_failed: number;
  summary: BatchSummary;
  predictions: BatchPrediction[];
  download_url: string;
}

export const FEATURE_READABLE_NAMES: Record<string, string> = {
  ambient_temp_c: 'Ambient Temperature',
  traffic_inflow_index: 'Traffic Inflow Index',
  active_plugs: 'Active Plugs',
  grid_frequency_hz: 'Grid Frequency',
  load_lag_15m: '15m Load Lag',
  load_lag_30m: '30m Load Lag',
  load_lag_45m: '45m Load Lag',
  load_lag_60m: '60m Load Lag',
  rolling_mean_60m: '60m Rolling Mean',
  rolling_std_60m: '60m Rolling Std',
  plug_delta_15m: '15m Plug Delta',
  hour_sin: 'Hour Cycle (sin)',
  hour_cos: 'Hour Cycle (cos)',
  day_sin: 'Day Cycle (sin)',
  day_cos: 'Day Cycle (cos)',
};

export function getFeatureReadableName(feature: string): string {
  if (FEATURE_READABLE_NAMES[feature]) {
    return FEATURE_READABLE_NAMES[feature];
  }
  return feature
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}


