import { useState, useMemo } from 'react';
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
import { getFeatureReadableName } from '../../types/telemetry';
import { Tile } from '../ui/Tile';
import { useData } from '../../context/DataContext';

interface Props {
  attributions: Attribution[];
}

export function ModelComparison({ attributions }: Props) {
  const { metricsData: metrics } = useData();
  const [isChartExpanded, setIsChartExpanded] = useState(false);

  const topFeaturesSentence = useMemo(() => {
    if (!attributions || attributions.length === 0) return '';
    const sorted = [...attributions].sort((a, b) => Math.abs(b.shap_delta_kw) - Math.abs(a.shap_delta_kw));
    const top2 = sorted.slice(0, 2).map(f => getFeatureReadableName(f.feature));
    if (top2.length === 2) {
      return `Prediction driven mainly by ${top2[0]} and ${top2[1]}.`;
    }
    return `Prediction driven mainly by ${top2[0]}.`;
  }, [attributions]);

  const errorChartData = useMemo(() => {
    if (!metrics || metrics.models.length < 2) return [];
    const model1 = metrics.models[0];
    const model2 = metrics.models[1];
    return [
      { name: 'MAE (kW)', [model1.name]: model1.mae_kw, [model2.name]: model2.mae_kw },
      { name: 'RMSE (kW)', [model1.name]: model1.rmse_kw, [model2.name]: model2.rmse_kw },
    ];
  }, [metrics]);

  const latencyChartData = useMemo(() => {
    if (!metrics || metrics.models.length < 2) return [];
    const model1 = metrics.models[0];
    const model2 = metrics.models[1];
    const lat1 = model1.latency_model_only_ms ?? model1.latency_ms;
    const lat2 = model2.latency_model_only_ms ?? model2.latency_ms;
    return [
      { name: 'Model Latency (ms)', [model1.name]: lat1, [model2.name]: lat2 },
    ];
  }, [metrics]);

  const latencyDomainMax = useMemo(() => {
    if (!metrics || metrics.models.length === 0) return 2.0;
    const maxVal = Math.max(...metrics.models.map(m => m.latency_model_only_ms ?? m.latency_ms ?? 0));
    return Math.max(1.5, Math.ceil((maxVal + 0.2) * 2) / 2);
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

    let accuracyStatement = '';
    if (maeDiff <= 1.0) {
      accuracyStatement = `MAE is comparable between both models (difference of ${maeDiff.toFixed(2)} kW)`;
    } else {
      const lowerMaeModel = deployed.mae_kw < benchmark.mae_kw ? deployedName : benchmarkName;
      accuracyStatement = `${lowerMaeModel} achieves lower MAE by ${maeDiff.toFixed(2)} kW`;
    }

    let recallStatement = '';
    if (recallDiff < 0.1) {
      recallStatement = 'equal critical surge recall';
    } else {
      const higherRecallModel = deployedCritRecall > benchmarkCritRecall ? deployedName : benchmarkName;
      recallStatement = `${higherRecallModel} achieves higher critical surge recall by ${recallDiff.toFixed(1)}%`;
    }

    return `${accuracyStatement}, while ${recallStatement}. XGBoost provides exact TreeSHAP attributions; LSTM serves as an offline benchmark.`;
  }, [metrics]);

  if (!metrics) return null;

  return (
    <Tile index={1} className="md:col-span-12 flex flex-col p-6 mt-6">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="font-headline-md text-headline-md text-text-primary mb-2">Model Comparison</h2>
          <p className="font-body-md text-text-secondary">{topFeaturesSentence}</p>
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
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">Critical recall (alert at ≥200 kW)</th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">Early-warning recall (alert at ≥162.5 kW)</th>
              <th className="py-3 px-4 font-label-mono text-label-mono text-text-secondary uppercase tracking-wider text-right">Latency (model only)</th>
            </tr>
          </thead>
          <tbody>
            {metrics.models.map((model, idx) => {
              const isActive = model.name.includes('(Primary)') || idx === 0;
              const modelLatency = model.latency_model_only_ms ?? model.latency_ms;
              const criticalRecall = model.rule_a_recall_pct ?? model.surge_recall_pct;
              return (
                <tr key={model.name} className={`border-b border-border-subtle/50 ${isActive ? 'bg-primary/5' : ''}`}>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <span className={`font-headline-sm text-text-primary ${isActive ? 'text-primary' : ''}`}>{model.name}</span>
                      {isActive && (
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
                    {criticalRecall.toFixed(1)}%
                  </td>
                  <td className="py-4 px-4 font-label-mono text-right tabular-nums text-text-primary">
                    {model.early_warning_recall_pct !== undefined ? `${model.early_warning_recall_pct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-4 px-4 font-label-mono text-right tabular-nums text-text-primary" title={`End-to-end latency: ${(model.latency_end_to_end_ms ?? model.latency_ms).toFixed(2)} ms`}>
                    {modelLatency.toFixed(2)} ms
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
          * Latency (model only) measures raw model inference time. End-to-end: XGBoost {(metrics.models[0]?.latency_end_to_end_ms ?? metrics.models[0]?.latency_ms)?.toFixed(1)} ms (includes feature assembly), LSTM {(metrics.models[1]?.latency_end_to_end_ms ?? metrics.models[1]?.latency_ms)?.toFixed(2)} ms. Note: LSTM benchmark figure excludes constructing the required 8-step sequence history, which the live ingestion pipeline does not maintain.
        </p>
      </div>

      {isChartExpanded && metrics.models.length >= 2 && (
        <div className="mt-8 pt-6 border-t border-border-subtle grid grid-cols-1 md:grid-cols-12 gap-6 min-h-72">
          {/* Main Error Metrics Chart (8-col) */}
          <div className="md:col-span-8 flex flex-col h-72">
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

          {/* Dedicated Latency Mini Panel (4-col) */}
          <div className="md:col-span-4 flex flex-col h-72 border-t md:border-t-0 md:border-l border-border-subtle/50 pt-4 md:pt-0 md:pl-6">
            <div className="text-xs font-label-mono text-text-secondary uppercase mb-2">
              Inference Latency (model only, ms) — Lower is better
            </div>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latencyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                    domain={[0, latencyDomainMax]}
                    ticks={latencyDomainMax === 0.8 ? [0, 0.2, 0.4, 0.6, 0.8] : undefined}
                    tickFormatter={(val: number) => `${val.toFixed(1)} ms`}
                    width={55}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(20, 20, 20, 0.95)', borderColor: 'var(--color-border-subtle)', borderRadius: '8px', backdropFilter: 'blur(12px)' }}
                    itemStyle={{ fontFamily: 'var(--font-label-mono)', fontSize: '13px' }}
                    labelStyle={{ color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '12px', fontFamily: 'var(--font-label-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    cursor={{ fill: 'var(--color-surface-variant)', opacity: 0.4 }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)} ms`]}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontFamily: 'var(--font-label-mono)' }}
                  />
                  <Bar
                    key="latency-bar-deployed"
                    dataKey={metrics.models[0].name}
                    fill="var(--color-primary)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                    minPointSize={6}
                    isAnimationActive={false}
                  />
                  <Bar
                    key="latency-bar-benchmark"
                    dataKey={metrics.models[1].name}
                    fill="var(--color-secondary)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                    minPointSize={6}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </Tile>
  );
}
