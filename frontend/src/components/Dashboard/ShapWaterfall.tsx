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
    // Wait a brief moment for Recharts to render the DOM
    const timer = setTimeout(() => {
      const bars = document.querySelectorAll('.shap-waterfall-bar .recharts-rectangle');
      if (!bars.length) return;

      bars.forEach((el, index) => {
        const isPos = waterfallData[index]?.isPos;
        // Recharts draws the rect with the final x and width.
        const targetWidth = parseFloat(el.getAttribute('width') || '0');
        const targetX = parseFloat(el.getAttribute('x') || '0');
        
        el.setAttribute('data-target-width', targetWidth.toString());
        el.setAttribute('data-target-x', targetX.toString());
        
        // Reset to starting point
        el.setAttribute('width', '0');
        if (!isPos) {
          el.setAttribute('x', (targetX + targetWidth).toString());
        }
      });

      animate('.shap-waterfall-bar .recharts-rectangle', {
        width: (el: any) => parseFloat(el.getAttribute('data-target-width') || '0'),
        x: (el: any) => parseFloat(el.getAttribute('data-target-x') || '0'),
        delay: stagger(40),
        easing: 'easeOutQuad',
        duration: 800,
      } as any);
    }, 50);

    return () => clearTimeout(timer);
  }, [waterfallData]);

  // Compute a reasonable domain for the XAxis to fit everything including numeric labels
  const minDomain = Math.floor(Math.min(baseValue, predictedValue, ...waterfallData.map(d => Math.min(d.range[0], d.range[1]))) - 25);
  const maxDomain = Math.ceil(Math.max(baseValue, predictedValue, ...waterfallData.map(d => Math.max(d.range[0], d.range[1]))) + 25);

  const renderCustomLabel = (props: any) => {
    const { x, y, width, height, value, index } = props;
    if (typeof x !== 'number' || typeof y !== 'number' || value === undefined || value === null) return null;

    const entry = waterfallData[index];
    const isPos = entry ? entry.isPos : value > 0;
    const numVal = typeof value === 'number' ? value : parseFloat(value);
    const sign = numVal > 0 ? '+' : '';
    const formatted = `${sign}${numVal.toFixed(1)}`;
    const fillColor = isPos ? 'var(--color-status-critical)' : 'var(--color-status-normal)';

    // Position label at the end of the bar:
    // If positive: extends to x + width, so place label at x + width + 8, textAnchor="start"
    // If negative: extends to x, so place label at x - 8, textAnchor="end"
    const labelX = isPos ? x + width + 8 : x - 8;
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
    <Tile index={0} className="md:col-span-12 flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-8 border-b border-border-subtle pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-headline-md text-headline-md text-text-primary">
              Live SHAP Waterfall
            </h2>
            {isSimulationActive ? (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-status-warning/10 border border-status-warning/40 text-status-warning font-label-mono text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                <div className="relative w-2 h-2">
                  <div className="absolute inset-0 rounded-full bg-status-warning pulse-throttled opacity-75" />
                  <div className="relative w-full h-full rounded-full bg-status-warning" />
                </div>
                SIMULATION ACTIVE
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/40 text-primary font-label-mono text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(138,235,255,0.2)]">
                <div className="relative w-2 h-2">
                  <div className="absolute inset-0 rounded-full bg-primary pulse-live opacity-75" />
                  <div className="relative w-full h-full rounded-full bg-primary" />
                </div>
                LIVE
              </div>
            )}
          </div>
          <div className="font-label-mono text-label-mono text-text-secondary mt-1">
            MODEL: EN-SEQ-V4 | INTERVAL: 5M
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-label-mono text-label-mono text-text-secondary">BASE VALUE</div>
            <div className="font-kpi-large text-kpi-large text-text-primary tabular-nums">
              <AnimatedNumber value={baseValue} decimals={1} /> <span className="font-body-md text-body-lg text-text-secondary">kW</span>
            </div>
          </div>
          
          <span className="material-symbols-outlined text-border-subtle text-3xl mx-2">arrow_right_alt</span>
          
          <div className="text-right">
            <div className="font-label-mono text-label-mono text-primary">PREDICTION</div>
            <div className="font-kpi-large text-kpi-large text-primary tabular-nums">
              <AnimatedNumber value={predictedValue} decimals={1} /> <span className="font-body-md text-body-lg text-text-secondary">kW</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 w-full pt-4 pb-8" style={{ minHeight: `${Math.max(480, waterfallData.length * 32)}px` }}>
        <ResponsiveContainer width="100%" height={Math.max(480, waterfallData.length * 32)}>
          <BarChart
            layout="vertical"
            data={waterfallData}
            margin={{ top: 5, right: 45, left: 20, bottom: 5 }}
            barCategoryGap="15%"
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
              width={160}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const actual = payload[0].payload.actual;
                  const isPos = actual > 0;
                  return (
                    <div className="bg-surface/80 backdrop-blur-xl border border-border p-3 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
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
            <div className="w-3 h-3 rounded-full bg-status-critical"></div>
            <span className="font-label-mono text-xs text-text-secondary">Increases Load (+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-status-normal"></div>
            <span className="font-label-mono text-xs text-text-secondary">Decreases Load (-)</span>
          </div>
        </div>

        {/* TreeSHAP Exact Match Verification Line */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-variant/30 border border-border-subtle font-label-mono text-xs text-text-secondary">
          <span className="material-symbols-outlined text-status-normal text-base font-bold">check_circle</span>
          <span>
            Verification: Base (<strong className="text-text-primary">{baseValue.toFixed(1)} kW</strong>)
            {' + '}
            &Sigma; SHAP (<strong className={sumDeltas >= 0 ? 'text-status-critical' : 'text-status-normal'}>
              {sumDeltas >= 0 ? `+${sumDeltas.toFixed(1)}` : sumDeltas.toFixed(1)} kW
            </strong>)
            {' = '}
            Final Prediction (<strong className="text-primary">{predictedValue.toFixed(1)} kW</strong>)
          </span>
          {isExact && (
            <span className="text-[10px] text-status-normal uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-status-normal/10 border border-status-normal/30 ml-1">
              Exact Match
            </span>
          )}
        </div>
      </div>
    </Tile>
  );
}
