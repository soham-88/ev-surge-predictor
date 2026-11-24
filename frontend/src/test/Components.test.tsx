import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StallGrid } from '../components/Dashboard/StallGrid';
import { ShapWaterfall, computeWaterfallDomain } from '../components/Dashboard/ShapWaterfall';
import { GlobalShapImportance } from '../components/Dashboard/GlobalShapImportance';
import { summarizeGlobalImportance } from '../utils/shapSummary';
import { api } from '../services/api';
import { getFeatureReadableName } from '../types/telemetry';

// Mock animejs for StallGrid's pulse animation
vi.mock('animejs', () => ({
  animate: () => ({
    pause: vi.fn(),
    play: vi.fn(),
  }),
}));

// Mock ResponsiveContainer to inject explicit width/height into Recharts chart
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 800, height: 600 }}>
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<any>, { width: 800, height: 600 })
          : children}
      </div>
    ),
  };
});

describe('Dashboard Visual Components', () => {
  describe('StallGrid Component', () => {
    it('renders all 8 charging bays and displays correct status tallies', () => {
      const bayStates = {
        1: { state: 'ACTIVE' as const, kwDraw: 25.0 },
        2: { state: 'ACTIVE' as const, kwDraw: 25.0 },
        3: { state: 'THROTTLED' as const, kwDraw: 12.5 },
        4: { state: 'THROTTLED' as const, kwDraw: 12.5 },
        5: { state: 'SHED' as const, kwDraw: 0.0 },
        6: { state: 'IDLE' as const, kwDraw: 0.0 },
        7: { state: 'IDLE' as const, kwDraw: 0.0 },
        8: { state: 'IDLE' as const, kwDraw: 0.0 },
      };

      render(
        <StallGrid
          activePlugs={4}
          throttledStalls={[3, 4]}
          shedStalls={[5]}
          perStallCapKw={12.5}
          bayStates={bayStates}
        />
      );

      // Verify header
      expect(screen.getByText('Bay Matrix Status')).toBeInTheDocument();

      // Verify all 8 bay numbers exist
      for (let i = 1; i <= 8; i++) {
        const padded = i.toString().padStart(2, '0');
        expect(screen.getByText(padded)).toBeInTheDocument();
      }

      // Verify statuses exist
      expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
      expect(screen.getAllByText('THROTTLED').length).toBeGreaterThan(0);
      expect(screen.getAllByText('SHED').length).toBeGreaterThan(0);
      expect(screen.getAllByText('IDLE').length).toBeGreaterThan(0);
    });
  });

  describe('ShapWaterfall Component', () => {
    const mockAttributions = [
      { feature: 'load_lag_15m', value: 1.25, shap_delta_kw: 12.4 },
      { feature: 'load_lag_30m', value: 0.85, shap_delta_kw: 6.2 },
      { feature: 'load_lag_45m', value: 0.55, shap_delta_kw: 3.1 },
      { feature: 'load_lag_60m', value: 0.32, shap_delta_kw: 1.8 },
      { feature: 'rolling_mean_60m', value: 1.10, shap_delta_kw: 5.5 },
      { feature: 'rolling_std_60m', value: 0.45, shap_delta_kw: -1.2 },
      { feature: 'traffic_inflow_index', value: 0.78, shap_delta_kw: 4.0 },
      { feature: 'ambient_temp_c', value: 0.62, shap_delta_kw: 2.1 },
      { feature: 'grid_frequency_hz', value: -0.05, shap_delta_kw: -0.8 },
      { feature: 'active_plugs', value: 0.90, shap_delta_kw: 8.3 },
      { feature: 'plug_delta_15m', value: 0.20, shap_delta_kw: 1.1 },
      { feature: 'load_anomaly', value: 1.05, shap_delta_kw: 4.2 },
      { feature: 'lag_trend', value: 0.15, shap_delta_kw: 2.3 },
      { feature: 'hour_sin', value: -0.71, shap_delta_kw: -3.5 },
      { feature: 'hour_cos', value: 0.71, shap_delta_kw: 2.7 },
      { feature: 'day_sin', value: 0.43, shap_delta_kw: 1.0 },
      { feature: 'day_cos', value: -0.90, shap_delta_kw: -2.3 },
    ];

    it('renders all 17 feature attribution labels in the waterfall chart', () => {
      render(
        <ShapWaterfall
          baseValue={142.5}
          predictedValue={182.2}
          attributions={mockAttributions}
        />
      );

      // Verify base value and prediction headers
      expect(screen.getByText('BASE VALUE')).toBeInTheDocument();
      expect(screen.getByText('PREDICTION')).toBeInTheDocument();

      // Verify all 17 readable feature names render
      const expectedReadableNames = mockAttributions.map((a) =>
        getFeatureReadableName(a.feature)
      );

      expect(expectedReadableNames).toHaveLength(17);
      for (const name of expectedReadableNames) {
        expect(screen.getByText(name)).toBeInTheDocument();
      }
    });

    describe('computeWaterfallDomain helper', () => {
      it('calculates a tight domain with ~8% padding rounded to nice tick values (multiples of 5)', () => {
        const base = 70;
        const attributions = [
          { feature: 'f1', shap_delta_kw: 25 },  // cumulative: 95
          { feature: 'f2', shap_delta_kw: -10 }, // cumulative: 85
          { feature: 'f3', shap_delta_kw: 30 },  // cumulative: 115
        ];
        const prediction = 115;

        const [minDomain, maxDomain] = computeWaterfallDomain(base, attributions, prediction);

        // Sorted order by absolute attribution: f3 (+30), f1 (+25), f2 (-10).
        // Cumulative steps: 70 -> 100 -> 125 -> 115.
        // Raw values range from 70 to 125 (span = 55 kW).
        // 8% padding of 55 is 4.4 kW.
        // Padded range: 65.6 to 129.4 kW.
        // Rounded to multiples of 5: floor(65.6/5)*5 = 65, ceil(129.4/5)*5 = 130.
        expect(minDomain).toBe(65);
        expect(maxDomain).toBe(130);
        expect(minDomain % 5).toBe(0);
        expect(maxDomain % 5).toBe(0);
        expect(minDomain).toBeLessThanOrEqual(70);
        expect(maxDomain).toBeGreaterThanOrEqual(115);
      });

      it('correctly encompasses negative cumulative dips', () => {
        const base = 100;
        const attributions = [
          { feature: 'f1', shap_delta_kw: -40 }, // cumulative: 60
          { feature: 'f2', shap_delta_kw: 10 },  // cumulative: 70
        ];
        const prediction = 70;

        const [minDomain, maxDomain] = computeWaterfallDomain(base, attributions, prediction);

        // Values span from 60 to 100 (span = 40 kW).
        // Padded: min <= 60, max >= 100.
        expect(minDomain).toBeLessThanOrEqual(60);
        expect(maxDomain).toBeGreaterThanOrEqual(100);
        expect(minDomain % 5).toBe(0);
        expect(maxDomain % 5).toBe(0);
      });

      it('handles empty attributions safely', () => {
        const [minDomain, maxDomain] = computeWaterfallDomain(80, [], 80);
        expect(minDomain).toBeLessThan(80);
        expect(maxDomain).toBeGreaterThan(80);
        expect(maxDomain).toBeGreaterThan(minDomain);
        expect(minDomain % 5).toBe(0);
        expect(maxDomain % 5).toBe(0);
      });
    });
  });

  describe('GlobalShapImportance & summarizeGlobalImportance', () => {
    const mockGlobalFeatureImportances = [
      { feature: 'hour_cos', mean_abs_shap_kw: 32.257, importance_pct: 44.4, rank: 1 },
      { feature: 'hour_sin', mean_abs_shap_kw: 22.192, importance_pct: 30.5, rank: 2 },
      { feature: 'day_sin', mean_abs_shap_kw: 8.422, importance_pct: 11.6, rank: 3 },
      { feature: 'traffic_inflow_index', mean_abs_shap_kw: 2.18, importance_pct: 3.0, rank: 4 },
      { feature: 'load_lag_60m', mean_abs_shap_kw: 1.38, importance_pct: 1.9, rank: 5 },
      { feature: 'rolling_mean_60m', mean_abs_shap_kw: 1.23, importance_pct: 1.7, rank: 6 },
      { feature: 'ambient_temp_c', mean_abs_shap_kw: 1.23, importance_pct: 1.7, rank: 7 },
      { feature: 'load_lag_15m', mean_abs_shap_kw: 0.94, importance_pct: 1.3, rank: 8 },
      { feature: 'load_lag_45m', mean_abs_shap_kw: 0.65, importance_pct: 0.9, rank: 9 },
      { feature: 'rolling_std_60m', mean_abs_shap_kw: 0.58, importance_pct: 0.8, rank: 10 },
      { feature: 'load_lag_30m', mean_abs_shap_kw: 0.44, importance_pct: 0.6, rank: 11 },
      { feature: 'grid_frequency_hz', mean_abs_shap_kw: 0.36, importance_pct: 0.5, rank: 12 },
      { feature: 'plug_delta_15m', mean_abs_shap_kw: 0.29, importance_pct: 0.4, rank: 13 },
      { feature: 'active_plugs', mean_abs_shap_kw: 0.29, importance_pct: 0.4, rank: 14 },
      { feature: 'day_cos', mean_abs_shap_kw: 0.15, importance_pct: 0.2, rank: 15 },
    ];

    describe('summarizeGlobalImportance pure function', () => {
      it('calculates category totals that sum to approximately 100%', () => {
        const summary = summarizeGlobalImportance(mockGlobalFeatureImportances);

        const totalPctSum = summary.categoryList.reduce((acc, cat) => acc + cat.sharePct, 0);
        expect(totalPctSum).toBeGreaterThanOrEqual(98.0);
        expect(totalPctSum).toBeLessThanOrEqual(102.0);

        // Check specific categories
        expect(summary.categoryTotals.Temporal.sharePct).toBe(86.7);
        expect(summary.categoryTotals.Historical.sharePct).toBe(7.2);
        expect(summary.categoryTotals.Physical.sharePct).toBe(3.8);
        expect(summary.categoryTotals.Weather.sharePct).toBe(1.7);
        expect(summary.categoryTotals.Grid.sharePct).toBe(0.5);
      });

      it('identifies dominant driver and top-3 share correctly', () => {
        const summary = summarizeGlobalImportance(mockGlobalFeatureImportances);

        expect(summary.dominantFeature).not.toBeNull();
        expect(summary.dominantFeature?.feature).toBe('hour_cos');
        expect(summary.dominantFeature?.name).toBe('Hour Cycle (cos)');
        expect(summary.dominantFeature?.sharePct).toBe(44.4);

        // Top 3 = 44.4 + 30.5 + 11.6 = 86.5%
        expect(summary.top3SharePct).toBe(86.5);
        expect(summary.temporalCombinedSharePct).toBe(86.7);
      });

      it('generates a truthful insight sentence containing exact API data and no forbidden terms', () => {
        const summary = summarizeGlobalImportance(mockGlobalFeatureImportances);

        expect(summary.insightSentence).toContain('86.7%');
        expect(summary.insightSentence).toContain('7.2%');
        expect(summary.insightSentence).toContain('1.7%');
        expect(summary.insightSentence.toLowerCase()).not.toContain('variance');
      });

      it('handles empty feature importances safely', () => {
        const summary = summarizeGlobalImportance([]);
        expect(summary.dominantFeature).toBeNull();
        expect(summary.top3SharePct).toBe(0);
        expect(summary.temporalCombinedSharePct).toBe(0);
        expect(summary.categoryList).toHaveLength(5);
      });
    });

    describe('GlobalShapImportance component rendering', () => {
      it('renders the header, summary chips, caveat, and accessible sr-only table', async () => {
        const mockApiResponse = {
          total_features: 17,
          sample_size: 200,
          n_samples: 200,
          split_name: 'test',
          total_test_rows: 1726,
          feature_importances: mockGlobalFeatureImportances,
        };

        vi.spyOn(api, 'explainGlobal').mockResolvedValueOnce(mockApiResponse);

        render(<GlobalShapImportance />);

        // Header check
        expect(await screen.findByText('Global Feature Importance')).toBeInTheDocument();
        expect(screen.getAllByText(/held-out test split \(1,726 rows\)/).length).toBeGreaterThan(0);

        // Summary chips check
        expect(screen.getByText('Dominant Driver')).toBeInTheDocument();
        expect(screen.getByText('44.4% share')).toBeInTheDocument();
        expect(screen.getByText('Temporal Share')).toBeInTheDocument();
        expect(screen.getByText('Top-3 Combined')).toBeInTheDocument();
        expect(screen.getByText('Sample Size')).toBeInTheDocument();
        expect(screen.getByText('N = 200 (test)')).toBeInTheDocument();

        // Caveat check
        expect(screen.getByText(/Training data is synthetic and strongly periodic/)).toBeInTheDocument();

        // Accessible SR table check & Chart tick labels check
        expect(screen.getByText('Tabular Summary of Global Feature Importance (TreeSHAP)')).toBeInTheDocument();
        expect(screen.getAllByText('Hour Cycle (cos)').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Ambient Temperature').length).toBeGreaterThan(0);
      });
    });
  });
});
