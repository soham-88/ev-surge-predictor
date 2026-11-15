import { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
} from 'recharts';
import { api } from '../../services/api';
import type { GlobalExplainResponse, GlobalFeatureImportanceItem } from '../../types/telemetry';
import { getFeatureReadableName } from '../../types/telemetry';
import { Tile } from '../ui/Tile';
import { Skeleton, SkeletonText } from '../ui';
import type {
  FeatureCategory,
  GlobalImportanceSummary,
} from '../../utils/shapSummary';
import {
  FEATURE_CATEGORY_MAP,
  CATEGORY_COLORS,
  FEATURE_NEUTRAL_DEFINITIONS,
  summarizeGlobalImportance,
} from '../../utils/shapSummary';

export { summarizeGlobalImportance };

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

  const summary: GlobalImportanceSummary | null = useMemo(() => {
    if (!data) return null;
    return summarizeGlobalImportance(data.feature_importances);
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.feature_importances.map((item: GlobalFeatureImportanceItem) => {
      const category = FEATURE_CATEGORY_MAP[item.feature] || 'Physical';
      const displayName = getFeatureReadableName(item.feature);
      const definition = FEATURE_NEUTRAL_DEFINITIONS[item.feature] || displayName;
      return {
        ...item,
        category,
        displayName,
        definition,
      };
    });
  }, [data]);

  const maxImportancePct = useMemo(() => {
    if (!chartData || chartData.length === 0) return 50;
    return Math.max(...chartData.map((d) => d.importance_pct), 10);
  }, [chartData]);

  const { maxTick, xAxisTicks } = useMemo(() => {
    const step = maxImportancePct <= 20 ? 5 : 10;
    const max = Math.ceil(maxImportancePct / step) * step;
    const ticks: number[] = [];
    for (let t = 0; t <= max; t += step) {
      ticks.push(t);
    }
    return { maxTick: max, xAxisTicks: ticks };
  }, [maxImportancePct]);

  if (isLoading) {
    return (
      <Tile index={0} className="md:col-span-12 flex flex-col justify-between">
        <div className="flex justify-between items-center mb-6">
          <SkeletonText className="w-64 h-7" />
          <Skeleton className="w-32 h-8 rounded-lg" />
        </div>
        <div className="flex flex-col gap-2.5 my-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <SkeletonText className="w-40 h-4 shrink-0" />
              <Skeleton className="h-5 w-full rounded bg-primary/10" />
            </div>
          ))}
        </div>
      </Tile>
    );
  }

  if (error || !data || !summary) {
    return (
      <Tile index={0} className="md:col-span-12 text-center py-12">
        <span className="material-symbols-outlined text-status-warning text-4xl mb-2" aria-hidden="true">warning</span>
        <p className="text-text-secondary font-label-mono">{error || 'Global explainability data is unavailable.'}</p>
      </Tile>
    );
  }

  const rowHeight = 24;
  const topMargin = 12;
  const bottomMargin = 20;
  const chartHeight = chartData.length * rowHeight + topMargin + bottomMargin;

  const sampleCount = data.n_samples ?? data.sample_size;
  const splitName = data.split_name ?? 'test';

  const renderCustomLabel = (props: any) => {
    const { x, y, width, height, index } = props;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const item = chartData[index];
    if (!item) return null;

    const labelText = `${item.mean_abs_shap_kw.toFixed(1)} kW  ${item.importance_pct.toFixed(1)}%`;
    const labelX = x + width + 8;
    const labelY = y + height / 2;

    return (
      <text
        x={labelX}
        y={labelY}
        fill="var(--color-text-secondary)"
        textAnchor="start"
        dominantBaseline="central"
        style={{
          fontFamily: 'var(--font-label-mono)',
          fontSize: '10.5px',
          fontWeight: 600,
        }}
      >
        {labelText}
      </text>
    );
  };

  return (
    <Tile index={0} className="md:col-span-12 flex flex-col min-w-0 max-w-full overflow-hidden">
      {/* Screen reader data table alternative */}
      <div className="sr-only">
        <h4>Tabular Summary of Global Feature Importance (TreeSHAP)</h4>
        <p>
          Mean |SHAP| over N={sampleCount} rows sampled from the held-out {splitName} split{data.total_test_rows ? ` (${data.total_test_rows.toLocaleString()} rows)` : ''}. Dominant driver is{' '}
          {summary.dominantFeature?.name} at {summary.dominantFeature?.sharePct}%. Top 3 features account for {summary.top3SharePct}% of total attribution.
        </p>
        <table>
          <caption>Ranked Global TreeSHAP Feature Importance</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Feature</th>
              <th scope="col">Category</th>
              <th scope="col">Mean Absolute SHAP (kW)</th>
              <th scope="col">Attribution Share (%)</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((item) => (
              <tr key={item.feature}>
                <td>{item.rank}</td>
                <td>{item.displayName}</td>
                <td>{item.category}</td>
                <td>{item.mean_abs_shap_kw.toFixed(3)} kW</td>
                <td>{item.importance_pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Header & Summary Chips */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border-subtle pb-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">bar_chart</span>
            <h2 className="font-headline-md text-headline-md text-text-primary">
              Global Feature Importance
            </h2>
          </div>
          <p className="font-label-mono text-label-mono text-text-secondary mt-1">
            Mean |SHAP| per feature (TreeSHAP) &bull; Mean |SHAP| over N={sampleCount} rows sampled from the held-out {splitName} split{data.total_test_rows ? ` (${data.total_test_rows.toLocaleString()} rows)` : ''}
          </p>
        </div>

        {/* Summary Chips */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Dominant Driver */}
          <div className="px-3 py-1.5 rounded-lg bg-surface-variant/30 border border-border-subtle flex flex-col font-label-mono">
            <span className="text-[10px] text-text-secondary uppercase tracking-wider">Dominant Driver</span>
            <span className="text-xs font-bold text-primary">
              {summary.dominantFeature?.name}
            </span>
            <span className="text-[11px] font-bold text-primary/90">
              {summary.dominantFeature?.sharePct.toFixed(1)}% share
            </span>
          </div>

          {/* Temporal Share */}
          <div className="px-3 py-1.5 rounded-lg bg-surface-variant/30 border border-border-subtle flex flex-col font-label-mono">
            <span className="text-[10px] text-text-secondary uppercase tracking-wider">Temporal Share</span>
            <span className="text-xs font-bold text-secondary">
              {summary.temporalCombinedSharePct.toFixed(1)}%
            </span>
          </div>

          {/* Top-3 Combined */}
          <div className="px-3 py-1.5 rounded-lg bg-surface-variant/30 border border-border-subtle flex flex-col font-label-mono">
            <span className="text-[10px] text-text-secondary uppercase tracking-wider">Top-3 Combined</span>
            <span className="text-xs font-bold text-primary-container">
              {summary.top3SharePct.toFixed(1)}%
            </span>
          </div>

          {/* Sample Size */}
          <div className="px-3 py-1.5 rounded-lg bg-surface-variant/30 border border-border-subtle flex flex-col font-label-mono">
            <span className="text-[10px] text-text-secondary uppercase tracking-wider">Sample Size</span>
            <span className="text-xs font-bold text-text-primary">
              N = {sampleCount} ({splitName})
            </span>
          </div>
        </div>
      </div>

      {/* Category Stacked Horizontal Bar & Legend */}
      <div className="flex flex-col gap-2 mb-3 px-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-label-mono">
          <span className="text-text-secondary uppercase tracking-wider text-[11px]">
            Attribution Share by Category
          </span>
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap" role="list" aria-label="Feature categories legend">
            {summary.categoryList.map((cat) => (
              <div key={cat.name} className="flex items-center gap-1.5" role="listitem">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: cat.color }}
                  aria-hidden="true"
                />
                <span className="text-text-secondary text-[11px]">
                  {cat.name} <strong className="text-text-primary font-bold">{cat.sharePct.toFixed(1)}%</strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Slim Stacked Horizontal Bar */}
        <div
          className="w-full h-2 rounded-full overflow-hidden flex bg-surface-container border border-border-subtle"
          role="img"
          aria-label={`Category share breakdown: ${summary.categoryList.map((c) => `${c.name} ${c.sharePct.toFixed(1)}%`).join(', ')}`}
        >
          {summary.categoryList.map((cat) => (
            <div
              key={cat.name}
              style={{
                width: `${cat.sharePct}%`,
                backgroundColor: cat.color,
              }}
              className="h-full transition-all duration-300"
              title={`${cat.name}: ${cat.sharePct.toFixed(1)}% (${cat.totalKw.toFixed(1)} kW)`}
            />
          ))}
        </div>
      </div>

      {/* Compact Horizontal Bar Chart */}
      <div className="w-full min-w-0" style={{ height: `${chartHeight}px` }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: topMargin, right: 110, left: 15, bottom: bottomMargin }}
            barCategoryGap="16%"
            aria-label={`Global feature importance ranking of 15 features. Dominant driver is ${summary.dominantFeature?.name} with ${summary.dominantFeature?.sharePct.toFixed(1)}% share.`}
          >
            <XAxis
              type="number"
              domain={[0, maxTick]}
              ticks={xAxisTicks}
              stroke="var(--color-border-subtle)"
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 10.5, fontFamily: 'var(--font-label-mono)' }}
              axisLine={false}
              tickLine={false}
              unit="%"
            />
            <YAxis
              dataKey="displayName"
              type="category"
              interval={0}
              stroke="var(--color-border-subtle)"
              tick={{ fill: 'var(--color-text-primary)', fontSize: 10.5, fontFamily: 'var(--font-label-mono)' }}
              axisLine={false}
              tickLine={false}
              width={160}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload;
                  return (
                    <div className="bg-surface/95 backdrop-blur-xl border border-border p-3 rounded-lg shadow-xl font-label-mono max-w-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CATEGORY_COLORS[item.category as FeatureCategory] }}
                          aria-hidden="true"
                        />
                        <span className="text-text-primary text-xs font-bold truncate">
                          {item.displayName}
                        </span>
                        <span className="text-[10px] uppercase text-text-secondary px-1.5 py-0.5 rounded bg-surface-container border border-border-subtle shrink-0">
                          {item.category}
                        </span>
                      </div>
                      <div className="text-primary text-sm font-bold my-1">
                        {item.mean_abs_shap_kw.toFixed(3)} kW ({item.importance_pct.toFixed(1)}%)
                      </div>
                      <p className="text-[11px] font-sans text-text-secondary leading-relaxed mt-1">
                        {item.definition}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
              cursor={{ fill: 'var(--color-surface-variant)', opacity: 0.3 }}
            />
            <Bar
              dataKey="importance_pct"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
              label={renderCustomLabel}
            >
              {chartData.map((entry) => (
                <Cell
                  key={`cell-${entry.feature}`}
                  fill={CATEGORY_COLORS[entry.category] || 'var(--color-primary)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insights & Caveat Footer */}
      <div className="mt-3 pt-3 border-t border-border-subtle flex flex-col gap-2.5 text-xs">
        <div className="flex items-start gap-2.5 text-text-secondary">
          <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5" aria-hidden="true">
            insights
          </span>
          <span className="font-sans leading-relaxed">
            <strong className="text-text-primary font-semibold font-label-mono">Attribution Insight: </strong>
            {summary.insightSentence}
          </span>
        </div>

        <div className="flex items-start gap-2.5 text-text-secondary">
          <span className="material-symbols-outlined text-status-warning text-[18px] shrink-0 mt-0.5" aria-hidden="true">
            info
          </span>
          <span className="font-sans leading-relaxed text-text-secondary/90">
            <strong className="text-text-primary font-semibold font-label-mono">Caveat: </strong>
            Training data is synthetic and strongly periodic, so time features dominate; on real station data the lag features are expected to matter more.
          </span>
        </div>
      </div>
    </Tile>
  );
}
