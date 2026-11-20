import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  FEATURE_READABLE_NAMES,
  getFeatureReadableName,
} from '../types/telemetry';
import {
  FEATURE_CATEGORY_MAP,
  FEATURE_NEUTRAL_DEFINITIONS,
} from '../utils/shapSummary';
import { ModelComparison } from '../components/Dashboard/ModelComparison';
import * as DataContextModule from '../context/DataContext';
import { buildScenarioPayload, TELEMETRY_SCENARIOS } from '../services/telemetryScenarios';
import type { TelemetryScenario } from '../services/telemetryScenarios';
import { formatBatchTimestampIST } from '../pages/BatchAnalysis';

const ALL_17_FEATURES = [
  'load_lag_15m',
  'load_lag_30m',
  'load_lag_45m',
  'load_lag_60m',
  'rolling_mean_60m',
  'rolling_std_60m',
  'load_anomaly',
  'lag_trend',
  'traffic_inflow_index',
  'ambient_temp_c',
  'grid_frequency_hz',
  'active_plugs',
  'plug_delta_15m',
  'hour_sin',
  'hour_cos',
  'day_sin',
  'day_cos',
];

describe('Model v2 Alignment Tests', () => {
  describe('Feature Mappings & Definitions (17 Features)', () => {
    it('covers all 17 features in FEATURE_READABLE_NAMES with non-empty labels', () => {
      expect(Object.keys(FEATURE_READABLE_NAMES)).toHaveLength(17);
      for (const feature of ALL_17_FEATURES) {
        expect(FEATURE_READABLE_NAMES[feature]).toBeDefined();
        expect(FEATURE_READABLE_NAMES[feature].trim().length).toBeGreaterThan(0);
        expect(getFeatureReadableName(feature)).toBe(FEATURE_READABLE_NAMES[feature]);
      }
      expect(FEATURE_READABLE_NAMES['load_anomaly']).toBe('Load vs Normal (hour-of-week)');
      expect(FEATURE_READABLE_NAMES['lag_trend']).toBe('Load Trend (60m to 15m)');
    });

    it('covers all 17 features in FEATURE_CATEGORY_MAP and maps new features to Historical', () => {
      expect(Object.keys(FEATURE_CATEGORY_MAP)).toHaveLength(17);
      for (const feature of ALL_17_FEATURES) {
        expect(FEATURE_CATEGORY_MAP[feature]).toBeDefined();
      }
      expect(FEATURE_CATEGORY_MAP['load_anomaly']).toBe('Historical');
      expect(FEATURE_CATEGORY_MAP['lag_trend']).toBe('Historical');
    });

    it('covers all 17 features in FEATURE_NEUTRAL_DEFINITIONS with descriptive sentences', () => {
      expect(Object.keys(FEATURE_NEUTRAL_DEFINITIONS)).toHaveLength(17);
      for (const feature of ALL_17_FEATURES) {
        const def = FEATURE_NEUTRAL_DEFINITIONS[feature];
        expect(def).toBeDefined();
        expect(def.length).toBeGreaterThan(15);
      }
      expect(FEATURE_NEUTRAL_DEFINITIONS['load_anomaly']).toContain('hour-of-week');
      expect(FEATURE_NEUTRAL_DEFINITIONS['lag_trend']).toContain('trajectory change');
    });
  });

  describe('ModelComparison Component Alignment', () => {
    const mockV2MetricsResponse = {
      models: [
        {
          name: 'XGBoost (Active Production)',
          mae_kw: 12.67,
          rmse_kw: 15.93,
          latency_ms: 6.30,
          latency_model_only_ms: 1.15,
          latency_end_to_end_ms: 6.30,
          surge_recall_pct: 81.9,
          rule_a_recall_pct: 81.9,
          early_warning_recall_pct: 99.6,
          rule_a_precision_pct: 84.7,
          n_test_samples: 9210,
        },
        {
          name: 'PyTorch LSTM (Benchmark)',
          mae_kw: 12.94,
          rmse_kw: 16.32,
          latency_ms: 0.44,
          latency_model_only_ms: 0.20,
          latency_end_to_end_ms: 0.44,
          surge_recall_pct: 78.8,
          rule_a_recall_pct: 78.8,
          early_warning_recall_pct: 99.7,
          rule_a_precision_pct: 86.4,
          n_test_samples: 9210,
        },
      ],
    };

    it('renders without latency chart, shows percentage points, and uses dynamic footnote', () => {
      vi.spyOn(DataContextModule, 'useData').mockReturnValue({
        metricsData: mockV2MetricsResponse,
      } as any);

      const { container } = render(<ModelComparison attributions={[]} />);

      // Columns check
      expect(screen.getByText('Critical recall (alert at ≥200 kW)')).toBeInTheDocument();
      expect(screen.getByText('Early-warning recall (alert at ≥162.5 kW)')).toBeInTheDocument();
      expect(screen.getByText('Latency (model only)')).toBeInTheDocument();

      // Values check
      expect(screen.getByText('1.15 ms')).toBeInTheDocument();
      expect(screen.getByText('0.20 ms')).toBeInTheDocument();
      expect(screen.getByText('81.9%')).toBeInTheDocument();
      expect(screen.getByText('78.8%')).toBeInTheDocument();
      expect(screen.getByText('99.6%')).toBeInTheDocument();
      expect(screen.getByText('99.7%')).toBeInTheDocument();

      // Latency chart MUST be removed
      expect(screen.queryByText(/Inference Latency/i)).toBeNull();

      // Footnote check: values from fields and exact development laptop sentence
      expect(screen.getByText(/identical held-out rows/)).toBeInTheDocument();
      expect(screen.getByText(/End-to-end: XGBoost 6.3 ms/)).toBeInTheDocument();
      expect(screen.getByText(/LSTM 0.44 ms/)).toBeInTheDocument();
      expect(screen.getByText(/LSTM benchmark figure excludes constructing the required 8-step sequence history/)).toBeInTheDocument();
      expect(screen.getByText(/Measured on a development laptop CPU; values vary between runs\./)).toBeInTheDocument();

      // Caption check: uses percentage points (pp) and no forbidden words
      const text = container.textContent || '';
      expect(text).toContain('percentage points (pp)');
      expect(text.toLowerCase()).not.toContain('faster');
      expect(text.toLowerCase()).not.toContain('fastest');
    });

    it('falls back gracefully to latency_ms and generic recall when v2 optional fields are absent', () => {
      const fallbackMetricsResponse = {
        models: [
          {
            name: 'XGBoost Model',
            mae_kw: 14.2,
            rmse_kw: 18.1,
            latency_ms: 4.5,
            surge_recall_pct: 80.0,
          },
          {
            name: 'LSTM Model',
            mae_kw: 15.0,
            rmse_kw: 19.0,
            latency_ms: 12.0,
            surge_recall_pct: 75.0,
          },
        ],
      };

      vi.spyOn(DataContextModule, 'useData').mockReturnValue({
        metricsData: fallbackMetricsResponse,
      } as any);

      const { container } = render(<ModelComparison attributions={[]} />);

      expect(screen.getByText('4.50 ms')).toBeInTheDocument();
      expect(screen.getByText('12.00 ms')).toBeInTheDocument();
      expect(screen.getByText('80.0%')).toBeInTheDocument();
      expect(screen.getByText('75.0%')).toBeInTheDocument();

      const text = container.textContent || '';
      expect(text.toLowerCase()).not.toContain('faster');
      expect(text.toLowerCase()).not.toContain('fastest');
    });
  });

  describe('Scenario Timestamp Builder (buildScenarioPayload) & Presets', () => {
    const dummyScenario: TelemetryScenario = {
      id: 'test_scen',
      name: 'Test Scenario',
      shortLabel: 'Test',
      badgeColor: 'bg-primary',
      expectedStatus: 'WARNING',
      description: 'Testing scenario builder',
      stationLocalTime: '17:00',
      prev_active_plugs: 8,
      telemetry: {
        load_lags_kw: [150.0, 140.0, 130.0, 120.0],
        active_plugs: 6,
        traffic_inflow_index: 0.8,
        ambient_temp_c: 32.0,
        grid_frequency_hz: 50.0,
      },
    };

    it('produces expected ISO string with +05:30 offset for known stationLocalTime', () => {
      const payload = buildScenarioPayload(dummyScenario);
      expect(payload.prev_active_plugs).toBe(8);
      expect(payload.timestamp).toBeDefined();
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T17:00:00\+05:30$/);
    });

    it('nominal preset has stationLocalTime 14:00 and produces +05:30 timestamp', () => {
      const nominal = TELEMETRY_SCENARIOS.find((s) => s.id === 'nominal');
      expect(nominal).toBeDefined();
      expect(nominal?.stationLocalTime).toBe('14:00');
      expect(nominal?.telemetry.active_plugs).toBe(3);
      expect(nominal?.prev_active_plugs).toBe(3);

      const payload = buildScenarioPayload(nominal!);
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T14:00:00\+05:30$/);
    });

    it('leaves timestamp and prev_active_plugs undefined when not set in scenario', () => {
      const scenarioWithoutTime: TelemetryScenario = {
        ...dummyScenario,
        stationLocalTime: undefined,
        prev_active_plugs: undefined,
      };
      const payload = buildScenarioPayload(scenarioWithoutTime);
      expect(payload.prev_active_plugs).toBeUndefined();
      expect(payload.timestamp).toBeUndefined();
    });
  });

  describe('Batch Timestamp Formatter (formatBatchTimestampIST)', () => {
    it('formats single-day UTC ISO timestamp to station-local IST HH:mm', () => {
      // 2024-12-31T19:30:00.000Z in UTC is 2025-01-01 01:00:00 in IST (+05:30)
      const istTime = formatBatchTimestampIST('2024-12-31T19:30:00.000Z', false);
      expect(istTime).toBe('01:00');

      // 2025-06-15T08:30:00.000Z in UTC is 2025-06-15 14:00:00 in IST
      const afternoonTime = formatBatchTimestampIST('2025-06-15T08:30:00.000Z', false);
      expect(afternoonTime).toBe('14:00');
    });

    it('formats multi-day UTC ISO timestamp to station-local IST with date prefix', () => {
      const multiDay = formatBatchTimestampIST('2024-12-31T19:30:00.000Z', true);
      expect(multiDay).toContain('Jan 1');
      expect(multiDay).toContain('01:00');
    });

    it('returns raw string safely for invalid timestamps', () => {
      expect(formatBatchTimestampIST('invalid-time')).toBe('invalid-time');
    });
  });
});
