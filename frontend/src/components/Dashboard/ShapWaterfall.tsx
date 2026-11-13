import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LabelList,
} from 'recharts';
import { useEffect, useMemo } from 'react';
import { animate, stagger } from 'animejs';
import type { Attribution } from '../../types/telemetry';
import { getFeatureReadableName } from '../../types/telemetry';
import { Tile } from '../ui/Tile';
import { AnimatedNumber } from '../ui/AnimatedNumber';

interface Props {
  baseValue: number;
  predictedValue: number;
  attributions: Attribution[];
  isSimulationActive?: boolean;
}

export function ShapWaterfall({ baseValue, predictedValue, attributions, isSimulationActive = false }: Props) {
  const waterfallData = useMemo(() => {
    let currentVal = baseValue;
    return attributions
      .map(a => ({ ...a, abs: Math.abs(a.shap_delta_kw) }))
      .sort((a, b) => b.abs - a.abs)
      .map((a) => {
        const actual = a.shap_delta_kw;
        const start = currentVal;
        currentVal += actual;
        const end = currentVal;
        const isPos = actual > 0;

        return {
          name: getFeatureReadableName(a.feature),
          actual,
          value: a.value,
          range: [start, end],
          isPos,
        };
      });
  }, [baseValue, attributions]);

  const sumDeltas = useMemo(() => {
    return attributions.reduce((acc, a) => acc + a.shap_delta_kw, 0);
  }, [attributions]);

  const calculatedTotal = baseValue + sumDeltas;
  const isExact = Math.abs(calculatedTotal - predictedValue) < 0.2;

  useEffect(() => {
    // If user prefers reduced motion, skip AnimeJS animation
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const timer = setTimeout(() => {
      const bars = document.querySelectorAll('.shap-waterfall-bar .recharts-rectangle');
      if (!bars.length) return;

      bars.forEach((el, index) => {
        const isPos = waterfallData[index]?.isPos;
        const targetWidth = parseFloat(el.getAttribute('width') || '0');
        const targetX = parseFloat(el.getAttribute('x') || '0');
        
        el.setAttribute('data-target-width', targetWidth.toString());
        el.setAttribute('data-target-x', targetX.toString());
        
        el.setAttribute('width', '0');
        if (!isPos) {
          el.setAttribute('x', (targetX + targetWidth).toString());
        }
      });

      animate('.shap-waterfall-bar .recharts-rectangle', {
        width: (el: any) => parseFloat(el.getAttribute('data-target-width') || '0'),
        x: (el: any) => parseFloat(el.getAttribute('data-target-x') || '0'),
        delay: stagger(30),
        easing: 'easeOutQuad',
        duration: 700,
      } as any);
    }, 50);

    return () => clearTimeout(timer);
  }, [waterfallData]);

  // Compute a generous domain for the XAxis so labels outside the bar ends are never clipped
  const allXValues = useMemo(() => {
    const vals = [baseValue, predictedValue];
    waterfallData.forEach(d => {
      vals.push(d.range[0]);
      vals.push(d.range[1]);
    });
    return vals;
  }, [baseValue, predictedValue, waterfallData]);

  const minVal = Math.min(...allXValues);
  const maxVal = Math.max(...allXValues);
  const rangeSpan = Math.max(1, maxVal - minVal);

  const minDomain = Math.floor(minVal - Math.max(30, rangeSpan * 0.15));
  const maxDomain = Math.ceil(maxVal + Math.max(45, rangeSpan * 0.22));

  const renderCustomLabel = (props: any) => {
    const { x, y, width, height, value, index } = props;
    if (typeof x !== 'number' || typeof y !== 'number' || value === undefined || value === null) return null;

    const entry = waterfallData[index];
    const isPos = entry ? entry.isPos : value > 0;
    const numVal = typeof value === 'number' ? value : parseFloat(value);
    const sign = numVal > 0 ? '+' : '';
    const formatted = `${sign}${numVal.toFixed(1)}`;
    const fillColor = isPos ? 'var(--color-status-critical)' : 'var(--color-status-normal)';

    // Compute exact bar horizontal edges
    const barLeft = Math.min(x, x + width);
    const barRight = Math.max(x, x + width);

    // Place label strictly OUTSIDE the outer end of the bar with enough padding
    const labelX = isPos ? barRight + 8 : barLeft - 8;
    const labelY = y + height / 2;

    return (
      <text
        x={labelX}
        y={labelY}
        fill={fillColor}
        textAnchor={isPos ? 'start' : 'end'}
        dominantBaseline="central"
        style={{
          fontFamily: 'var(--font-label-mono)',
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        {formatted}
      </text>
    );
  };

  return (
    <Tile index={0} className="md:col-span-12 flex flex-col h-full min-w-0 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6 border-b border-border-subtle pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-headline-md text-headline-md text-text-primary">
              Live SHAP Waterfall
            </h2>
            {isSimulationActive ? (
              <div
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-status-warning/10 border border-status-warning/40 text-status-warning font-label-mono text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.2)]"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">science</span>
                SIMULATION ACTIVE
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/40 text-primary font-label-mono text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(138,235,255,0.2)]">
                <div className="relative w-2 h-2" aria-hidden="true">
                  <div className="absolute inset-0 rounded-full bg-primary pulse-live opacity-75" />
                  <div className="relative w-full h-full rounded-full bg-primary" />
                </div>
                LIVE
              </div>
            )}
          </div>
          <div className="font-label-mono text-label-mono text-text-secondary mt-1">
            MODEL: XGBOOST REGRESSOR | ATTRIBUTIONS: TREESHAP
          </div>
        </div>
        
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-right">
            <div className="font-label-mono text-label-mono text-text-secondary">BASE VALUE</div>
            <div className="font-kpi-large text-kpi-large text-text-primary tabular-nums">
              <AnimatedNumber value={baseValue} decimals={1} /> <span className="font-body-md text-body-lg text-text-secondary">kW</span>
            </div>
          </div>
          
          <span className="material-symbols-outlined text-border-subtle text-3xl mx-1" aria-hidden="true">arrow_right_alt</span>
          
          <div className="text-right">
            <div className="font-label-mono text-label-mono text-primary">PREDICTION</div>
            <div className="font-kpi-large text-kpi-large text-primary tabular-nums">
              <AnimatedNumber value={predictedValue} decimals={1} /> <span className="font-body-md text-body-lg text-text-secondary">kW</span>
            </div>
          </div>
        </div>
      </div>

      {/* Screen Reader Summary */}
      <div className="sr-only">
        SHAP Waterfall Chart: Base value {baseValue.toFixed(1)} kW, Prediction {predictedValue.toFixed(1)} kW.
        {waterfallData.slice(0, 3).map(d => `${d.name}: ${d.actual > 0 ? '+' : ''}${d.actual.toFixed(1)} kW`).join(', ')}.
      </div>

      {/* Chart */}
      <div className="flex-1 w-full pt-2 pb-6 min-w-0" style={{ minHeight: `${Math.max(520, waterfallData.length * 36)}px` }}>
        <ResponsiveContainer width="100%" height={Math.max(520, waterfallData.length * 36)}>
          <BarChart
            layout="vertical"
            data={waterfallData}
            margin={{ top: 10, right: 65, left: 15, bottom: 10 }}
            barCategoryGap="18%"
            aria-label={`SHAP feature attribution waterfall. Base load ${baseValue.toFixed(1)} kW, predicted load ${predictedValue.toFixed(1)} kW`}
          >
            <defs>
              <filter id="neonShadowPos" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="var(--color-status-critical)" floodOpacity="0.4" />
              </filter>
              <filter id="neonShadowNeg" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="var(--color-status-normal)" floodOpacity="0.4" />
              </filter>
            </defs>
            <XAxis
              type="number"
              domain={[minDomain, maxDomain]}
              stroke="var(--color-border-subtle)"
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11, fontFamily: 'var(--font-label-mono)' }}
              axisLine={false}
              tickLine={false}
              unit=" kW"
            />
            <YAxis
              dataKey="name"
              type="category"
              interval={0}
              stroke="var(--color-border-subtle)"
              tick={{ fill: 'var(--color-text-primary)', fontSize: 10.5, fontFamily: 'var(--font-label-mono)' }}
              axisLine={false}
              tickLine={false}
              width={150}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const actual = payload[0].payload.actual;
                  const isPos = actual > 0;
                  return (
                    <div className="bg-surface/90 backdrop-blur-xl border border-border p-3 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                      <p className="text-text-secondary text-xs mb-1 uppercase tracking-wider font-label-mono">
                        {payload[0].payload.name}
                      </p>
                      <p className={`font-bold font-label-mono text-lg ${isPos ? 'text-status-critical' : 'text-status-normal'}`}>
                        {isPos ? '+' : ''}{actual.toFixed(2)} kW
                      </p>
                    </div>
                  );
                }
                return null;
              }}
              cursor={{ fill: 'var(--color-surface-variant)', opacity: 0.4 }}
            />
            <Bar 
              dataKey="range" 
              className="shap-waterfall-bar" 
              radius={[0, 6, 6, 0]} 
              isAnimationActive={false}
            >
              <LabelList dataKey="actual" content={renderCustomLabel} />
              {waterfallData.map((entry, index) => {
                const isPos = entry.isPos;
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={isPos ? 'var(--color-status-critical)' : 'var(--color-status-normal)'}
                    fillOpacity={1}
                    filter={isPos ? 'url(#neonShadowPos)' : 'url(#neonShadowNeg)'}
                  />
                );
              })}
            </Bar>
            <ReferenceLine
              x={predictedValue}
              stroke="var(--color-primary)"
              strokeDasharray="3 3"
              label={{ position: 'top', value: 'Prediction', fill: 'var(--color-primary)', fontSize: 11, fontFamily: 'var(--font-label-mono)' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend Footer & TreeSHAP Exact Match Verification */}
      <div className="mt-4 pt-4 border-t border-border-subtle flex flex-col sm:flex-row justify-between sm:items-center gap-4 text-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-status-critical inline-block" aria-hidden="true" />
            <span className="font-label-mono text-xs text-text-secondary">
              Increases Load (+)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-status-normal inline-block" aria-hidden="true" />
            <span className="font-label-mono text-xs text-text-secondary">
              Decreases Load (-)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-variant/30 border border-border-subtle font-label-mono text-xs text-text-secondary">
          <span className="material-symbols-outlined text-status-normal text-base font-bold" aria-hidden="true">
            check_circle
          </span>
          <span>
            Verification: Base (<strong className="text-text-primary">{baseValue.toFixed(1)} kW</strong>) + 
            Σ SHAP (<strong className={sumDeltas >= 0 ? "text-status-critical" : "text-status-normal"}>
              {sumDeltas > 0 ? `+${sumDeltas.toFixed(1)}` : sumDeltas.toFixed(1)} kW
            </strong>) = 
            Final Prediction (<strong className="text-primary">{predictedValue.toFixed(1)} kW</strong>)
          </span>
          {isExact && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-status-normal/10 text-status-normal border border-status-normal/30 font-bold">
              EXACT ADDITIVITY
            </span>
          )}
        </div>
      </div>
    </Tile>
  );
}
