import type { PredictRequest } from '../types/telemetry';

export interface TelemetryScenario {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  badgeColor: string;
  expectedStatus: 'NORMAL' | 'WARNING' | 'CRITICAL';
  stationLocalTime?: string;
  prev_active_plugs?: number;
  telemetry: {
    ambient_temp_c: number;
    traffic_inflow_index: number;
    active_plugs: number;
    grid_frequency_hz: number;
    load_lags_kw: [number, number, number, number];
  };
}

export function buildScenarioPayload(scen: TelemetryScenario): PredictRequest {
  let timestamp: string | undefined;
  if (scen.stationLocalTime) {
    const today = new Date().toISOString().split('T')[0];
    timestamp = `${today}T${scen.stationLocalTime}:00+05:30`;
  }
  return {
    ...scen.telemetry,
    ...(timestamp ? { timestamp } : {}),
    ...(scen.prev_active_plugs !== undefined ? { prev_active_plugs: scen.prev_active_plugs } : {}),
  };
}

export interface ScenarioTimelinePoint {
  time?: number;
  timestamp: string;
  historical_kw: number | null;
  forecast_kw: number | null;
  lower_kw: number | null;
  upper_kw: number | null;
  corridor_range: [number, number] | null;
  interval_error?: [number, number] | null;
  baseline_kw: number;
  simulated_kw: number;
}

export function formatTimelineTimestamp(timestampStr: string | number): string {
  const d = new Date(timestampStr);
  if (isNaN(d.getTime())) return String(timestampStr);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function buildScenarioTimeline(
  scen: TelemetryScenario,
  predictData?: {
    predicted_load_kw: number;
    lower_bound_kw?: number;
    upper_bound_kw?: number;
  } | null,
  baseDate?: string
): ScenarioTimelinePoint[] {
  const dateStr = baseDate || new Date().toISOString().split('T')[0];
  const localTime = scen.stationLocalTime || '12:00';
  const nowIso = `${dateStr}T${localTime}:00+05:30`;
  const nowMs = new Date(nowIso).getTime();

  const lags = scen.telemetry.load_lags_kw; // [lag_15m, lag_30m, lag_45m, lag_60m]
  const lag60 = lags[3];
  const lag15 = lags[0];

  const forecastKw = predictData ? predictData.predicted_load_kw : lag15;
  const lowerKw = predictData?.lower_bound_kw !== undefined
    ? predictData.lower_bound_kw
    : Math.max(0, Math.round((forecastKw - 10.9) * 10) / 10);
  const upperKw = predictData?.upper_bound_kw !== undefined
    ? predictData.upper_bound_kw
    : Math.round((forecastKw + 16.6) * 10) / 10;

  const points: ScenarioTimelinePoint[] = [];

  // 1. Earlier history: exactly 4 points (t-120m, t-105m, t-90m, t-75m)
  const earlierSteps = [120, 105, 90, 75];
  for (let idx = 0; idx < earlierSteps.length; idx++) {
    const minsAgo = earlierSteps[idx];
    const k = earlierSteps.length - idx; // 4, 3, 2, 1
    const delta = (k * 1.8) - Math.sin(k * 1.2) * 3.5;
    const kw = Math.round(Math.max(15, lag60 - delta) * 10) / 10;
    const tMs = nowMs - minsAgo * 60 * 1000;
    points.push({
      time: tMs,
      timestamp: new Date(tMs).toISOString(),
      historical_kw: kw,
      forecast_kw: null,
      lower_kw: null,
      upper_kw: null,
      corridor_range: null,
      interval_error: null,
      baseline_kw: kw,
      simulated_kw: kw,
    });
  }

  // 2. The first three lag points: t-60m, t-45m, t-30m
  const lagDefs: Array<{ minsAgo: number; kw: number }> = [
    { minsAgo: 60, kw: lags[3] }, // lag_60m
    { minsAgo: 45, kw: lags[2] }, // lag_45m
    { minsAgo: 30, kw: lags[1] }, // lag_30m
  ];
  for (const ld of lagDefs) {
    const tMs = nowMs - ld.minsAgo * 60 * 1000;
    points.push({
      time: tMs,
      timestamp: new Date(tMs).toISOString(),
      historical_kw: ld.kw,
      forecast_kw: null,
      lower_kw: null,
      upper_kw: null,
      corridor_range: null,
      interval_error: null,
      baseline_kw: ld.kw,
      simulated_kw: ld.kw,
    });
  }

  // 3. Point at t-15m: 8th actual point AND start of forecast line!
  const t15Ms = nowMs - 15 * 60 * 1000;
  points.push({
    time: t15Ms,
    timestamp: new Date(t15Ms).toISOString(),
    historical_kw: lag15,
    forecast_kw: lag15,
    lower_kw: null,
    upper_kw: null,
    corridor_range: null,
    interval_error: null,
    baseline_kw: lag15,
    simulated_kw: lag15,
  });

  // 4. Point at t+2h (t+120m): end of forecast line with prediction interval
  const t2hMs = nowMs + 120 * 60 * 1000;
  const lowerDiff = Math.max(0, Math.round((forecastKw - lowerKw) * 10) / 10);
  const upperDiff = Math.max(0, Math.round((upperKw - forecastKw) * 10) / 10);
  points.push({
    time: t2hMs,
    timestamp: new Date(t2hMs).toISOString(),
    historical_kw: null,
    forecast_kw: forecastKw,
    lower_kw: lowerKw,
    upper_kw: upperKw,
    corridor_range: [lowerKw, upperKw],
    interval_error: [lowerDiff, upperDiff],
    baseline_kw: forecastKw,
    simulated_kw: forecastKw,
  });

  return points;
}

export const TELEMETRY_SCENARIOS: TelemetryScenario[] = [
  {
    id: 'nominal',
    name: 'Nominal Midday',
    shortLabel: 'Nominal',
    description: 'Moderate weekday charging at 12:00 local with 3 bays active and stable grid conditions.',
    badgeColor: 'text-status-normal border-status-normal/30 bg-status-normal/10',
    expectedStatus: 'NORMAL',
    stationLocalTime: '12:00',
    prev_active_plugs: 3,
    telemetry: {
      ambient_temp_c: 35.7,
      traffic_inflow_index: 36,
      active_plugs: 3,
      grid_frequency_hz: 50.04,
      load_lags_kw: [83.9, 92.8, 96.7, 102.0],
    },
  },
  {
    id: 'evening_peak',
    name: 'Evening Commute Surge',
    shortLabel: 'Rush Hour',
    description: 'High commuter traffic and 6 active bays pushing transformer to ~75% capacity.',
    badgeColor: 'text-status-warning border-status-warning/30 bg-status-warning/10',
    expectedStatus: 'WARNING',
    stationLocalTime: '17:00',
    prev_active_plugs: 5,
    telemetry: {
      ambient_temp_c: 30.5,
      traffic_inflow_index: 68,
      active_plugs: 6,
      grid_frequency_hz: 49.95,
      load_lags_kw: [185.0, 175.0, 168.0, 160.0],
    },
  },
  {
    id: 'heatwave_surge',
    name: 'Summer Heatwave (Critical)',
    shortLabel: 'Heatwave',
    description: '41°C extreme temperature, 8 full stalls, triggering automated bay throttling & load shedding.',
    badgeColor: 'text-status-critical border-status-critical/30 bg-status-critical/10',
    expectedStatus: 'CRITICAL',
    stationLocalTime: '16:30',
    prev_active_plugs: 7,
    telemetry: {
      ambient_temp_c: 41.5,
      traffic_inflow_index: 85,
      active_plugs: 8,
      grid_frequency_hz: 49.88,
      load_lags_kw: [225.0, 215.0, 204.0, 192.0],
    },
  },
  {
    id: 'monsoon_lull',
    name: 'Monsoon Low Demand',
    shortLabel: 'Monsoon',
    description: 'Cool rainy period with light traffic and only 2 bays utilized.',
    badgeColor: 'text-primary border-primary/30 bg-primary/10',
    expectedStatus: 'NORMAL',
    stationLocalTime: '03:15',
    prev_active_plugs: 2,
    telemetry: {
      ambient_temp_c: 24.2,
      traffic_inflow_index: 22,
      active_plugs: 2,
      grid_frequency_hz: 50.06,
      load_lags_kw: [55.0, 56.0, 58.0, 60.0],
    },
  },
];
