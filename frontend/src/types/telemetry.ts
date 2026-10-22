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

