import { getFeatureReadableName } from '../types/telemetry';

export type FeatureCategory = 'Temporal' | 'Historical' | 'Physical' | 'Weather' | 'Grid';

export const FEATURE_CATEGORY_MAP: Record<string, FeatureCategory> = {
  hour_cos: 'Temporal',
  hour_sin: 'Temporal',
  day_sin: 'Temporal',
  day_cos: 'Temporal',
  load_lag_15m: 'Historical',
  load_lag_30m: 'Historical',
  load_lag_45m: 'Historical',
  load_lag_60m: 'Historical',
  rolling_mean_60m: 'Historical',
  rolling_std_60m: 'Historical',
  load_anomaly: 'Historical',
  lag_trend: 'Historical',
  traffic_inflow_index: 'Physical',
  active_plugs: 'Physical',
  plug_delta_15m: 'Physical',
  ambient_temp_c: 'Weather',
  grid_frequency_hz: 'Grid',
};

export const CATEGORY_COLORS: Record<FeatureCategory, string> = {
  Temporal: 'var(--color-secondary)',           // #d0bcff
  Historical: 'var(--color-primary-container)', // #22d3ee
  Physical: 'var(--color-status-warning)',      // #f59e0b
  Weather: 'var(--color-status-normal)',        // #10b981
  Grid: 'var(--color-status-critical)',         // #f43f5e
};

export const FEATURE_NEUTRAL_DEFINITIONS: Record<string, string> = {
  hour_cos: 'Cosine component of hour of day (24h diurnal cycle)',
  hour_sin: 'Sine component of hour of day (24h diurnal cycle)',
  day_sin: 'Sine component of day of week (7d weekly cycle)',
  day_cos: 'Cosine component of day of week (7d weekly cycle)',
  load_lag_15m: 'Observed station load 15 minutes prior',
  load_lag_30m: 'Observed station load 30 minutes prior',
  load_lag_45m: 'Observed station load 45 minutes prior',
  load_lag_60m: 'Observed station load 60 minutes prior',
  rolling_mean_60m: 'Mean station load over preceding 60 minutes',
  rolling_std_60m: 'Standard deviation of station load over preceding 60 minutes',
  load_anomaly: 'Deviation of current load from station-local hour-of-week historical baseline',
  lag_trend: 'Rate of load trajectory change between 60 minutes and 15 minutes prior',
  traffic_inflow_index: 'Index of inbound vehicular traffic near station',
  active_plugs: 'Number of charging bays currently occupied (0-8)',
  plug_delta_15m: 'Net arrival/departure rate over preceding 15 minutes',
  ambient_temp_c: 'Ambient outdoor temperature in degrees Celsius',
  grid_frequency_hz: 'AC line frequency in Hertz (50 Hz nominal)',
};

export interface CategorySummary {
  name: FeatureCategory;
  totalKw: number;
  sharePct: number;
  color: string;
  features: string[];
}

export interface DominantFeatureSummary {
  feature: string;
  name: string;
  meanAbsShapKw: number;
  sharePct: number;
  category: FeatureCategory;
}

export interface GlobalImportanceSummary {
  categoryTotals: Record<FeatureCategory, CategorySummary>;
  categoryList: CategorySummary[];
  dominantFeature: DominantFeatureSummary | null;
  topNSharePct: (n: number) => number;
  top3SharePct: number;
  temporalCombinedSharePct: number;
  insightSentence: string;
}

export function summarizeGlobalImportance(
  attributions: Array<{
    feature: string;
    mean_abs_shap_kw: number;
    importance_pct: number;
    rank?: number;
  }>
): GlobalImportanceSummary {
  const categories: FeatureCategory[] = ['Temporal', 'Historical', 'Physical', 'Weather', 'Grid'];

  const categoryTotals: Record<FeatureCategory, CategorySummary> = {
    Temporal: { name: 'Temporal', totalKw: 0, sharePct: 0, color: CATEGORY_COLORS.Temporal, features: [] },
    Historical: { name: 'Historical', totalKw: 0, sharePct: 0, color: CATEGORY_COLORS.Historical, features: [] },
    Physical: { name: 'Physical', totalKw: 0, sharePct: 0, color: CATEGORY_COLORS.Physical, features: [] },
    Weather: { name: 'Weather', totalKw: 0, sharePct: 0, color: CATEGORY_COLORS.Weather, features: [] },
    Grid: { name: 'Grid', totalKw: 0, sharePct: 0, color: CATEGORY_COLORS.Grid, features: [] },
  };

  if (!attributions || attributions.length === 0) {
    return {
      categoryTotals,
      categoryList: categories.map((cat) => categoryTotals[cat]),
      dominantFeature: null,
      topNSharePct: () => 0,
      top3SharePct: 0,
      temporalCombinedSharePct: 0,
      insightSentence: 'No attribution data available.',
    };
  }

  // Accumulate per category
  for (const item of attributions) {
    const cat = FEATURE_CATEGORY_MAP[item.feature] || 'Physical';
    categoryTotals[cat].totalKw += item.mean_abs_shap_kw || 0;
    categoryTotals[cat].sharePct += item.importance_pct || 0;
    categoryTotals[cat].features.push(item.feature);
  }

  // Round category share percentages to 1 decimal place
  for (const cat of categories) {
    categoryTotals[cat].sharePct = Math.round(categoryTotals[cat].sharePct * 10) / 10;
    categoryTotals[cat].totalKw = Math.round(categoryTotals[cat].totalKw * 100) / 100;
  }

  // Sort attributions by mean_abs_shap_kw descending
  const sorted = [...attributions].sort(
    (a, b) => (b.mean_abs_shap_kw || 0) - (a.mean_abs_shap_kw || 0)
  );

  const dominant = sorted[0];
  const dominantCategory = FEATURE_CATEGORY_MAP[dominant.feature] || 'Physical';
  const dominantFeature: DominantFeatureSummary = {
    feature: dominant.feature,
    name: getFeatureReadableName(dominant.feature),
    meanAbsShapKw: dominant.mean_abs_shap_kw,
    sharePct: dominant.importance_pct,
    category: dominantCategory,
  };

  const topNSharePct = (n: number): number => {
    const topSlice = sorted.slice(0, n);
    const sum = topSlice.reduce((acc, curr) => acc + (curr.importance_pct || 0), 0);
    return Math.round(sum * 10) / 10;
  };

  const top3SharePct = topNSharePct(3);
  const temporalCombinedSharePct = categoryTotals.Temporal.sharePct;

  const temporalStr = categoryTotals.Temporal.sharePct.toFixed(1);
  const historicalStr = categoryTotals.Historical.sharePct.toFixed(1);
  const weatherStr = categoryTotals.Weather.sharePct.toFixed(1);

  const insightSentence = `Time-of-day and day-of-week features account for ${temporalStr}% of total attribution; load lag and rolling features ${historicalStr}%; weather ${weatherStr}%.`;

  return {
    categoryTotals,
    categoryList: categories.map((cat) => categoryTotals[cat]),
    dominantFeature,
    topNSharePct,
    top3SharePct,
    temporalCombinedSharePct,
    insightSentence,
  };
}
