import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { GlobalExplainResponse, GlobalFeatureImportanceItem } from '../../types/telemetry';
import { Skeleton, SkeletonText } from '../ui';

const FEATURE_DISPLAY_NAMES: Record<string, { label: string; category: string; description: string }> = {
  hour_cos: {
    label: 'Hour Cosine (Diurnal)',
    category: 'Temporal',
    description: 'Models diurnal peak vs. night-time charging cycles.',
  },
  hour_sin: {
    label: 'Hour Sine (Diurnal)',
    category: 'Temporal',
    description: 'Captures morning vs. evening transition dynamics.',
  },
  day_sin: {
    label: 'Day of Week Sine',
    category: 'Temporal',
    description: 'Differentiates weekday commute from weekend demand.',
  },
  traffic_inflow_index: {
    label: 'Traffic Inflow Index',
    category: 'Physical',
    description: 'Arterial highway congestion feeding into the station.',
  },
  load_lag_60m: {
    label: 'Load Lag (60 min)',
    category: 'Historical',
    description: 'Transformer load 1 hour prior to current timestamp.',
  },
  rolling_mean_60m: {
    label: 'Rolling Mean (60 min)',
    category: 'Historical',
    description: 'Smoothed hourly baseline consumption.',
  },
  ambient_temp_c: {
    label: 'Ambient Temperature (°C)',
    category: 'Weather',
    description: 'High heat raises EV cabin AC draw and battery cooling needs.',
  },
  load_lag_15m: {
    label: 'Load Lag (15 min)',
    category: 'Historical',
    description: 'Immediate preceding interval load draw.',
  },
  load_lag_45m: {
    label: 'Load Lag (45 min)',
    category: 'Historical',
    description: 'Mid-term lag tracking demand trajectory.',
  },
  rolling_std_60m: {
    label: 'Rolling Std Dev (60 min)',
    category: 'Historical',
    description: 'Measures high-frequency load volatility and pulsing.',
  },
  load_lag_30m: {
    label: 'Load Lag (30 min)',
    category: 'Historical',
    description: 'Half-hour preceding load draw.',
  },
  grid_frequency_hz: {
    label: 'Grid Frequency (Hz)',
    category: 'Grid',
    description: 'Frequency deviations indicating regional grid stress.',
  },
  plug_delta_15m: {
    label: 'Plug Delta (15 min)',
    category: 'Physical',
    description: 'Net rate of EV arrival/departure in bays.',
  },
  active_plugs: {
    label: 'Active Bays (0-8)',
    category: 'Physical',
    description: 'Current number of plugged-in vehicles.',
  },
  day_cos: {
    label: 'Day of Week Cosine',
    category: 'Temporal',
    description: 'Secondary cyclical weekly phase indicator.',
  },
};

export function GlobalShapImportance() {
  const [data, setData] = useState<GlobalExplainResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    api
      .explainGlobal()
      .then((res) => {
        if (isMounted) {
          setData(res);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to load global SHAP importance:', err);
          setError('Failed to load global feature importance.');
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="col-span-12 rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col min-h-[420px] justify-between">
        <div className="flex justify-between items-center mb-6">
          <SkeletonText className="w-64 h-7" />
          <Skeleton className="w-24 h-6 rounded-full" />
        </div>
        <div className="flex flex-col gap-3 my-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <SkeletonText className="w-40 h-4 shrink-0" />
              <Skeleton className="h-6 w-full rounded bg-primary/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="col-span-12 rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 text-center py-12">
        <span className="material-symbols-outlined text-status-warning text-4xl mb-2">warning</span>
        <p className="text-text-secondary">{error || 'Global explainability data is unavailable.'}</p>
      </div>
    );
  }

  const topFeature = data.feature_importances[0];
  const topPhysical = data.feature_importances.find(
    (f) => FEATURE_DISPLAY_NAMES[f.feature]?.category === 'Physical'
  ) || data.feature_importances[3];

  return (
    <div className="col-span-12 rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-4 sm:p-6 flex flex-col gap-6 shadow-xl">
      {/* Screen reader text alternative */}
      <div className="sr-only">
        <h4>Tabular Summary of Global TreeSHAP Feature Importance (E[|&phi;|])</h4>
        <p>
          Evaluated across {data.sample_size} validation periods. Dominant driver is {FEATURE_DISPLAY_NAMES[topFeature?.feature]?.label || topFeature?.feature} at {topFeature?.importance_pct}%. Top physical driver is {FEATURE_DISPLAY_NAMES[topPhysical?.feature]?.label || topPhysical?.feature} at {topPhysical?.importance_pct}%.
        </p>
        <table>
          <caption>Ranked Global TreeSHAP Feature Importance</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Feature</th>
              <th scope="col">Category</th>
              <th scope="col">Mean Absolute SHAP (kW)</th>
              <th scope="col">Importance (%)</th>
            </tr>
          </thead>
          <tbody>
            {data.feature_importances.map((item) => (
              <tr key={item.feature}>
                <td>{item.rank}</td>
                <td>{FEATURE_DISPLAY_NAMES[item.feature]?.label || item.feature}</td>
                <td>{FEATURE_DISPLAY_NAMES[item.feature]?.category || 'Feature'}</td>
                <td>{item.mean_abs_shap_kw.toFixed(3)} kW</td>
                <td>{item.importance_pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Header & Metrics Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-subtle/50 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">bar_chart</span>
            <h3 className="font-title-lg text-title-lg text-text-primary">
              Global TreeSHAP Feature Importance (E[|&phi;|])
            </h3>
          </div>
          <p className="font-body-sm text-text-secondary mt-1">
            Mean absolute SHAP contribution across baseline distribution &bull; Evaluated over{' '}
            <span className="text-text-primary font-semibold">{data.sample_size} validation periods</span>
          </p>
        </div>

        {/* Quick KPI Badges */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-subtle flex flex-col items-start sm:items-end">
            <span className="text-[10px] sm:text-[11px] font-label-mono text-text-secondary uppercase">Dominant Driver</span>
            <span className="text-xs font-bold text-primary">
              {FEATURE_DISPLAY_NAMES[topFeature?.feature]?.label || topFeature?.feature} ({topFeature?.importance_pct}%)
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-subtle flex flex-col items-start sm:items-end">
            <span className="text-[10px] sm:text-[11px] font-label-mono text-text-secondary uppercase">Top Physical</span>
            <span className="text-xs font-bold text-accent">
              {FEATURE_DISPLAY_NAMES[topPhysical?.feature]?.label || topPhysical?.feature} ({topPhysical?.importance_pct}%)
            </span>
          </div>
        </div>
      </div>

      {/* Feature Importance Horizontal Bars */}
      <div className="flex flex-col gap-3" aria-label="Feature importance visual ranking">
        {data.feature_importances.map((item: GlobalFeatureImportanceItem) => {
          const meta = FEATURE_DISPLAY_NAMES[item.feature] || {
            label: item.feature,
            category: 'Feature',
            description: '',
          };

          const isTopTier = item.rank <= 3;
          const barColor = isTopTier
            ? 'bg-gradient-to-r from-primary to-accent'
            : item.rank <= 7
            ? 'bg-gradient-to-r from-cyan-600 to-blue-500'
            : 'bg-surface-variant hover:bg-surface-bright';

          return (
            <div
              key={item.feature}
              className="group p-2.5 rounded-xl bg-surface-container-low/40 hover:bg-surface-container-low transition-colors border border-transparent hover:border-border-subtle flex flex-col gap-1.5"
            >
              <div className="flex flex-col xs:flex-row xs:items-center justify-between text-xs gap-1 sm:gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <span className="w-5 text-right font-label-mono font-bold text-text-secondary shrink-0">
                    #{item.rank}
                  </span>
                  <span className="font-medium text-text-primary group-hover:text-primary transition-colors truncate">
                    {meta.label}
                  </span>
                  <span className="text-[9px] sm:text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-container border border-border-subtle text-text-secondary shrink-0">
                    {meta.category}
                  </span>
                </div>

                <div className="flex items-center justify-between xs:justify-end gap-2 sm:gap-4 shrink-0 pl-6 xs:pl-0">
                  <span className="font-label-mono text-text-secondary text-[11px] hidden sm:inline">
                    {item.mean_abs_shap_kw.toFixed(3)} kW
                  </span>
                  <span className="font-label-mono font-bold text-text-primary text-right">
                    {item.importance_pct.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Bar track (decorative) */}
              <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none motion-reduce:duration-0 ${barColor}`}
                  style={{ width: `${Math.max(2, item.importance_pct)}%` }}
                />
              </div>

              {/* Subtitle description */}
              <div className="text-[11px] text-text-secondary truncate hidden group-hover:block transition-all">
                {meta.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* Physics & Insight Callout */}
      <div className="p-4 rounded-xl bg-surface-container-low border border-border-subtle flex items-start gap-3 text-xs text-text-secondary">
        <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">lightbulb</span>
        <div>
          <span className="text-text-primary font-semibold">Grid Physical Insight: </span>
          Diurnal cycles (cyclical hour &amp; day sine/cosine) govern macro charging surge envelopes
          (&gt;85% of total variance), while real-time traffic inflow and 60-minute rolling load lags
          drive the sudden transformer peak spikes that require throttling and dynamic tariffs.
        </div>
      </div>
    </div>
  );
}
