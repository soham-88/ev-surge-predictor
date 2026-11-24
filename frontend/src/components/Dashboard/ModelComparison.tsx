import { useState, useMemo, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { Attribution } from '../../types/telemetry';
import { Tile } from '../ui/Tile';
import { useData } from '../../context/DataContext';
import { api } from '../../services/api';
import { summarizeGlobalImportance } from '../../utils/shapSummary';

interface Props {
  attributions?: Attribution[];
}

export function ModelComparison(_props: Props) {
  const { metricsData: metrics } = useData();
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [globalSummarySentence, setGlobalSummarySentence] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    api
      .explainGlobal()
      .then((res) => {
        if (isMounted && res.feature_importances) {
          const summary = summarizeGlobalImportance(res.feature_importances);
          const temporalPct = summary.categoryTotals.Temporal.sharePct;
          const historicalPct = summary.categoryTotals.Historical.sharePct;
          setGlobalSummarySentence(
            `Time-of-day features set the daily baseline (${temporalPct.toFixed(1)}% of importance); recent-load features adjust it (${historicalPct.toFixed(1)}%).`
          );
        }
      })
      .catch(() => {
        // Leave empty or fallback if API is unavailable
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const errorChartData = useMemo(() => {
    if (!metrics || metrics.models.length < 2) return [];
    const model1 = metrics.models[0];
    const model2 = metrics.models[1];
    return [
      { name: 'MAE (kW)', [model1.name]: model1.mae_kw, [model2.name]: model2.mae_kw },
      { name: 'RMSE (kW)', [model1.name]: model1.rmse_kw, [model2.name]: model2.rmse_kw },
    ];
  }, [metrics]);

  const dynamicCaption = useMemo(() => {
    if (!metrics || metrics.models.length < 2) {
      if (metrics?.models.length === 1) {
        return `Deployed: ${metrics.models[0].name}. XGBoost provides exact TreeSHAP attributions.`;
      }
      return '';
    }

    const deployed = metrics.models[0];
    const benchmark = metrics.models[1];

    const getShortName = (name?: string) => {
      if (!name) return 'Model';
      if (name.toLowerCase().includes('xgboost')) return 'XGBoost';
      if (name.toLowerCase().includes('lstm')) return 'LSTM';
      return name.replace(/\s*\([^)]*\)/g, '').trim();
    };

    const deployedName = getShortName(deployed.name);
    const benchmarkName = getShortName(benchmark.name);

    const maeDiff = Math.abs(deployed.mae_kw - benchmark.mae_kw);
    const deployedCritRecall = deployed.rule_a_recall_pct ?? deployed.surge_recall_pct;
    const benchmarkCritRecall = benchmark.rule_a_recall_pct ?? benchmark.surge_recall_pct;
    const recallDiff = Math.abs(deployedCritRecall - benchmarkCritRecall);

    const accuracyStatement =
      maeDiff <= 1.0
        ? `MAE is comparable between both models (difference of ${maeDiff.toFixed(2)} kW)`
        : `${deployed.mae_kw < benchmark.mae_kw ? deployedName : benchmarkName} achieves lower MAE by ${maeDiff.toFixed(2)} kW`;

    const recallStatement =
      recallDiff < 0.1
        ? 'equal critical surge recall'
        : `${deployedCritRecall > benchmarkCritRecall ? deployedName : benchmarkName} achieves higher critical surge recall by ${recallDiff.toFixed(1)} percentage points (pp)`;

    return `${accuracyStatement}, while ${recallStatement}. XGBoost provides exact TreeSHAP attributions; LSTM serves as an offline benchmark.`;
  }, [metrics]);

  if (!metrics) return null;

  return (
    <Tile index={1} className="md:col-span-12 flex flex-col p-6 mt-6">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="font-headline-md text-headline-md text-text-primary mb-2">Model Comparison</h2>
          <p className="font-body-md text-text-secondary">{globalSummarySentence}</p>
        </div>
        <button 
          onClick={() => setIsChartExpanded(!isChartExpanded)}
          className={`p-2 rounded-lg transition-colors cursor-pointer border border-transparent ${isChartExpanded ? 'bg-primary/10 text-primary border-primary/30' : 'hover:bg-surface-variant text-text-secondary opacity-50 hover:opacity-100'}`}
          title={isChartExpanded ? "Collapse comparison chart" : "Expand comparison chart"}
        >
          <span className="material-symbols-outlined">
            {isChartExpanded ? 'unfold_less' : 'unfold_more'}
          </span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider">Model</th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">MAE (kW)</th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">RMSE (kW)</th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">
                Critical recall (alert at &ge;200 kW)
              </th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">
                Early-warning recall (alert at &ge;162.5 kW)
              </th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">
                Latency (model only)
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.models.map((model, idx) => {
              const isDeployed = idx === 0;
              const critRecall = model.rule_a_recall_pct ?? model.surge_recall_pct;
              const earlyRecall = model.early_warning_recall_pct;
              const modelLatency = model.latency_model_only_ms ?? model.latency_ms;
              const e2eLatency = model.latency_end_to_end_ms ?? model.latency_ms;

              return (
                <tr 
                  key={model.name} 
                  className={`border-b border-border-subtle/50 ${isDeployed ? 'bg-primary/5' : ''}`}
                >
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <span className={`font-headline-sm text-text-primary ${isDeployed ? 'text-primary' : ''}`}>
                        {model.name}
                      </span>
                      {isDeployed && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold font-label-mono bg-primary/20 text-primary border border-primary/30 uppercase tracking-widest">
                          Active
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4 font-label-mono text-right text-text-primary tabular-nums">
                    {model.mae_kw.toFixed(2)}
                  </td>
                  <td className="py-4 px-4 font-label-mono text-right text-text-primary tabular-nums">
                    {model.rmse_kw.toFixed(2)}
                  </td>
                  <td className="py-4 px-4 font-label-mono text-right tabular-nums text-text-primary">
                    {critRecall !== undefined ? `${critRecall.toFixed(1)}%` : '-'}
                  </td>
                  <td className="py-4 px-4 font-label-mono text-right tabular-nums text-text-primary">
                    {earlyRecall !== undefined ? `${earlyRecall.toFixed(1)}%` : '-'}
                  </td>
                  <td 
                    className="py-4 px-4 font-label-mono text-right tabular-nums text-text-primary"
                    title={`End-to-end latency: ${e2eLatency.toFixed(2)} ms`}
                  >
                    {modelLatency !== undefined ? `${modelLatency.toFixed(2)} ms` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dynamicCaption && (
        <div className="mt-3 pt-3 border-t border-border-subtle/50 flex items-center gap-2 text-xs font-label-mono text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0"></span>
          <span>{dynamicCaption}</span>
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-border-subtle/30 flex flex-col gap-1 text-[11px] font-label-mono text-text-secondary/80 leading-relaxed">
        <p>
          * Evaluated on {metrics.models[0]?.n_test_samples ? metrics.models[0].n_test_samples.toLocaleString() : 'held-out'} identical held-out rows of synthetic data.
        </p>
        <p>
          * Latency (model only) measures raw model inference time. End-to-end: XGBoost {(metrics.models[0]?.latency_end_to_end_ms ?? metrics.models[0]?.latency_ms)?.toFixed(1)} ms (includes feature assembly), LSTM {(metrics.models[1]?.latency_end_to_end_ms ?? metrics.models[1]?.latency_ms)?.toFixed(2)} ms. Note: LSTM benchmark figure excludes constructing the required 8-step sequence history, which the live ingestion pipeline does not maintain. Measured on a development laptop CPU; values vary between runs.
        </p>
      </div>

      {isChartExpanded && metrics.models.length >= 2 && (
        <div className="mt-8 pt-6 border-t border-border-subtle flex flex-col gap-6 min-h-72">
          {/* Main Error Metrics Chart */}
          <div className="w-full flex flex-col h-72">
            <div className="text-xs font-label-mono text-text-secondary uppercase mb-2">
              Error Metrics (kW) — Lower is better
            </div>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={errorChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="var(--color-border-subtle)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontFamily: 'var(--font-label-mono)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="var(--color-border-subtle)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontFamily: 'var(--font-label-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    unit=" kW"
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(20, 20, 20, 0.95)', borderColor: 'var(--color-border-subtle)', borderRadius: '8px', backdropFilter: 'blur(12px)' }}
                    itemStyle={{ fontFamily: 'var(--font-label-mono)', fontSize: '13px' }}
                    labelStyle={{ color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '12px', fontFamily: 'var(--font-label-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    cursor={{ fill: 'var(--color-surface-variant)', opacity: 0.4 }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontFamily: 'var(--font-label-mono)' }}
                  />
                  <Bar dataKey={metrics.models[0].name} fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  <Bar dataKey={metrics.models[1].name} fill="var(--color-secondary)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </Tile>
  );
}
