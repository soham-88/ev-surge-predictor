export interface TelemetryScenario {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  badgeColor: string;
  expectedStatus: 'NORMAL' | 'WARNING' | 'CRITICAL';
  telemetry: {
    ambient_temp_c: number;
    traffic_inflow_index: number;
    active_plugs: number;
    grid_frequency_hz: number;
    load_lags_kw: [number, number, number, number];
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
    telemetry: {
      ambient_temp_c: 33.8,
      traffic_inflow_index: 82,
      active_plugs: 6,
      grid_frequency_hz: 49.92,
      load_lags_kw: [172.0, 168.5, 162.0, 155.0],
    },
  },
  {
    id: 'heatwave_surge',
    name: 'Summer Heatwave (Critical)',
    shortLabel: 'Heatwave',
    description: '41°C extreme temperature, 8 full stalls, triggering automated bay throttling & load shedding.',
    badgeColor: 'text-status-critical border-status-critical/30 bg-status-critical/10',
    expectedStatus: 'CRITICAL',
    telemetry: {
      ambient_temp_c: 41.5,
      traffic_inflow_index: 95,
      active_plugs: 8,
      grid_frequency_hz: 49.88,
      load_lags_kw: [218.0, 212.5, 204.0, 195.0],
    },
  },
  {
    id: 'monsoon_lull',
    name: 'Monsoon Low Demand',
    shortLabel: 'Monsoon',
    description: 'Cool rainy period with light traffic and only 2 bays utilized.',
    badgeColor: 'text-primary border-primary/30 bg-primary/10',
    expectedStatus: 'NORMAL',
    telemetry: {
      ambient_temp_c: 24.2,
      traffic_inflow_index: 22,
      active_plugs: 2,
      grid_frequency_hz: 50.06,
      load_lags_kw: [65.0, 62.5, 59.0, 58.0],
    },
  },
];
