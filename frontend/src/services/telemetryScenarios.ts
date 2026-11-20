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

export const TELEMETRY_SCENARIOS: TelemetryScenario[] = [
  {
    id: 'nominal',
    name: 'Nominal Afternoon',
    shortLabel: 'Nominal',
    description: 'Moderate weekday charging with 4 bays active and stable grid conditions.',
    badgeColor: 'text-status-normal border-status-normal/30 bg-status-normal/10',
    expectedStatus: 'NORMAL',
    telemetry: {
      ambient_temp_c: 30.5,
      traffic_inflow_index: 45,
      active_plugs: 4,
      grid_frequency_hz: 50.01,
      load_lags_kw: [102.5, 98.0, 95.2, 92.0],
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
