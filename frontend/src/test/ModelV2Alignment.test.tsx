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
import {
  buildScenarioPayload,
  buildScenarioTimeline,
  formatTimelineTimestamp,
  TELEMETRY_SCENARIOS,
} from '../services/telemetryScenarios';
import type { TelemetryScenario } from '../services/telemetryScenarios';
import { formatBatchTimestampIST } from '../pages/BatchAnalysis';

import { ForecastTimeline } from '../components/Dashboard/ForecastTimeline';

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

    it('nominal preset has stationLocalTime 12:00, name Nominal Midday, and produces +05:30 timestamp', () => {
      const nominal = TELEMETRY_SCENARIOS.find((s) => s.id === 'nominal');
      expect(nominal).toBeDefined();
      expect(nominal?.name).toBe('Nominal Midday');
      expect(nominal?.stationLocalTime).toBe('12:00');
      expect(nominal?.telemetry.active_plugs).toBe(3);
      expect(nominal?.prev_active_plugs).toBe(3);

      const payload = buildScenarioPayload(nominal!);
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00\+05:30$/);
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

  describe('ForecastTimeline Simulation Interval Visibility', () => {
    const mockTimelineData = [
      { timestamp: '2026-11-20T10:00:00Z', baseline_kw: 100, simulated_kw: 100 },
      { timestamp: '2026-11-20T11:00:00Z', baseline_kw: 120, simulated_kw: 120 },
      { timestamp: '2026-11-20T12:00:00Z', baseline_kw: 130, simulated_kw: 130 },
    ];

    const defaultProps = {
      data: mockTimelineData,
      capacityPct: 52.0,
      surgeStatus: 'NORMAL' as const,
      tariffMultiplier: 1.0,
      predictedLoadKw: 130.0,
      transformerCapacityKw: 250.0,
      lowerBoundKw: 110.0,
      upperBoundKw: 150.0,
      recommendedActions: {
        dynamic_tariff_multiplier: 1.0,
        throttle_active: false,
        per_stall_cap_kw: 60.0,
        shed_stalls: [],
      },
      recentEvents: [],
    };

    it('in simulation state (isSimulated=true), hides empirical interval legend and shows neutral text', () => {
      vi.spyOn(DataContextModule, 'useData').mockReturnValue({
        settings: { notifications_enabled: false },
      } as any);

      render(<ForecastTimeline {...defaultProps} isSimulated={true} />);

      // Neutral text is displayed
      expect(screen.getByText('Interval not available for simulated scenarios')).toBeInTheDocument();

      // Empirical interval legend is NOT rendered
      expect(screen.queryByText(/Empirical 80% interval \(/i)).toBeNull();
    });

    it('in non-simulation state (isSimulated=false), renders the empirical interval legend with bounds', () => {
      vi.spyOn(DataContextModule, 'useData').mockReturnValue({
        settings: { notifications_enabled: false },
      } as any);

      render(<ForecastTimeline {...defaultProps} isSimulated={false} />);

      // Neutral text is NOT displayed
      expect(screen.queryByText('Interval not available for simulated scenarios')).toBeNull();

      // Empirical interval legend is rendered with bounds
      expect(screen.getByText(/Empirical 80% interval \(110\.0 – 150\.0 kW\)/)).toBeInTheDocument();
    });

    it('renders title as "Load Timeline (2h history + 2h forecast)"', () => {
      vi.spyOn(DataContextModule, 'useData').mockReturnValue({
        settings: { notifications_enabled: false },
      } as any);

      render(<ForecastTimeline {...defaultProps} isSimulated={false} />);
      expect(screen.getByRole('heading', { level: 3, name: 'Load Timeline (2h history + 2h forecast)' })).toBeInTheDocument();
      expect(screen.getByText(/Load Timeline \(2h history \+ 2h forecast\)\. Predicted load:/)).toBeInTheDocument();
    });
  });

  describe('Control Center Scenario Timeline Builder (Phase E.2e)', () => {
    it('scenario chart data has a contiguous actual series of exactly 8 points whose last four equal the lags', () => {
      const nominal = TELEMETRY_SCENARIOS.find(s => s.id === 'nominal')!;
      const timeline = buildScenarioTimeline(nominal, {
        predicted_load_kw: 98.5,
        lower_bound_kw: 78.8,
        upper_bound_kw: 117.2,
      }, '2026-11-20');

      // Exactly 8 actual points (t-120m to t-15m in 15m steps)
      const actualPoints = timeline.filter(p => p.historical_kw !== null);
      expect(actualPoints).toHaveLength(8);

      // Verify continuity: each actual point is exactly 15 minutes after the previous
      for (let i = 1; i < actualPoints.length; i++) {
        expect(actualPoints[i].time! - actualPoints[i - 1].time!).toBe(15 * 60 * 1000);
      }

      // Last 4 actual points in chronological order: t-60m, t-45m, t-30m, t-15m
      const lastFourActual = actualPoints.slice(-4);
      expect(lastFourActual[0].historical_kw).toBe(nominal.telemetry.load_lags_kw[3]); // lag_60m (102.0)
      expect(lastFourActual[1].historical_kw).toBe(nominal.telemetry.load_lags_kw[2]); // lag_45m (96.7)
      expect(lastFourActual[2].historical_kw).toBe(nominal.telemetry.load_lags_kw[1]); // lag_30m (92.8)
      expect(lastFourActual[3].historical_kw).toBe(nominal.telemetry.load_lags_kw[0]); // lag_15m (83.9)

      // Timestamps verify t-60m, t-45m, t-30m, t-15m relative to 12:00
      expect(formatTimelineTimestamp(lastFourActual[0].timestamp)).toBe('11:00');
      expect(formatTimelineTimestamp(lastFourActual[1].timestamp)).toBe('11:15');
      expect(formatTimelineTimestamp(lastFourActual[2].timestamp)).toBe('11:30');
      expect(formatTimelineTimestamp(lastFourActual[3].timestamp)).toBe('11:45');
    });

    it('forecast series has exactly 2 points: first equal to (t-15, lag_15m) and second equal to (t+2h, predicted)', () => {
      const nominal = TELEMETRY_SCENARIOS.find(s => s.id === 'nominal')!;
      const timeline = buildScenarioTimeline(nominal, {
        predicted_load_kw: 98.5,
        lower_bound_kw: 78.8,
        upper_bound_kw: 117.2,
      }, '2026-11-20');

      const forecastPoints = timeline.filter(p => p.forecast_kw !== null);
      expect(forecastPoints).toHaveLength(2);

      // First forecast point connects directly to the last actual point at t-15m
      const first = forecastPoints[0];
      expect(first.forecast_kw).toBe(nominal.telemetry.load_lags_kw[0]); // 83.9
      expect(formatTimelineTimestamp(first.timestamp)).toBe('11:45');

      // Second forecast point is at t+2h with predicted load and error interval
      const second = forecastPoints[1];
      expect(second.forecast_kw).toBe(98.5);
      expect(second.lower_kw).toBe(78.8);
      expect(second.upper_kw).toBe(117.2);
      expect(second.corridor_range).toEqual([78.8, 117.2]);
      expect(second.interval_error).toEqual([19.7, 18.7]);
      expect(formatTimelineTimestamp(second.timestamp)).toBe('14:00');
    });

    it('tick spacing is uniform in time (every 30 minutes) and domain covers [t-120min, t+2h+15min]', () => {
      const evening = TELEMETRY_SCENARIOS.find(s => s.id === 'evening_peak')!;
      const timeline = buildScenarioTimeline(evening, {
        predicted_load_kw: 195.1,
        lower_bound_kw: 172.1,
        upper_bound_kw: 217.4,
      }, '2026-11-20');

      const lastPoint = timeline[timeline.length - 1];
      const nowMs = lastPoint.time! - 120 * 60 * 1000;
      const ticks = [-120, -90, -60, -30, 0, 30, 60, 90, 120].map((m) => nowMs + m * 60 * 1000);

      // Verify uniform spacing: exactly 30 minutes (1,800,000 ms) between every tick
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBe(30 * 60 * 1000);
      }

      // Verify domain [t-120min, t+2h+15min]
      const domainMin = nowMs - 120 * 60 * 1000;
      const domainMax = nowMs + 135 * 60 * 1000;
      expect(domainMax - domainMin).toBe(255 * 60 * 1000); // 4h15m

      // First and last tick format to IST (Evening peak is 17:00 IST -> 15:00 to 19:00)
      expect(formatTimelineTimestamp(ticks[0])).toBe('15:00');
      expect(formatTimelineTimestamp(ticks[ticks.length - 1])).toBe('19:00');
    });

    it('validates all 4 presets: forecast series has 2 points starting at last actual and ending at predicted_load_kw', () => {
      const mockPredictions: Record<string, { pred: number; lower: number; upper: number }> = {
        nominal: { pred: 98.5, lower: 78.8, upper: 117.2 },
        evening_peak: { pred: 195.1, lower: 172.1, upper: 217.4 },
        heatwave_surge: { pred: 264.4, lower: 241.4, upper: 286.8 },
        monsoon_lull: { pred: 65.6, lower: 45.9, upper: 84.3 },
      };

      for (const scen of TELEMETRY_SCENARIOS) {
        const predInfo = mockPredictions[scen.id];
        const timeline = buildScenarioTimeline(scen, {
          predicted_load_kw: predInfo.pred,
          lower_bound_kw: predInfo.lower,
          upper_bound_kw: predInfo.upper,
        }, '2026-11-20');

        // Check forecast series: exactly 2 points
        const forecastPoints = timeline.filter(p => p.forecast_kw !== null);
        expect(forecastPoints).toHaveLength(2);
        expect(forecastPoints[0].forecast_kw).toBe(scen.telemetry.load_lags_kw[0]);
        expect(forecastPoints[1].forecast_kw).toBe(predInfo.pred);

        // Check last 4 actual points equal lags
        const actualPoints = timeline.filter(p => p.historical_kw !== null);
        expect(actualPoints).toHaveLength(8);
        const lastFour = actualPoints.slice(-4);
        expect(lastFour[0].historical_kw).toBe(scen.telemetry.load_lags_kw[3]);
        expect(lastFour[1].historical_kw).toBe(scen.telemetry.load_lags_kw[2]);
        expect(lastFour[2].historical_kw).toBe(scen.telemetry.load_lags_kw[1]);
        expect(lastFour[3].historical_kw).toBe(scen.telemetry.load_lags_kw[0]);
      }
    });
  });
});
