import { useState, useEffect } from 'react';
import type { PredictResponse, ExplainResponse, SimulateResponse } from '../types/telemetry';
import { mockPredictResponse, mockExplainResponse, mockSimulateResponse } from '../services/mockData';

export function useMockTelemetry(isPaused: boolean = false) {
  const [mockData, setMockData] = useState<{
    predictData: PredictResponse;
    explainData: ExplainResponse;
    simulateData: SimulateResponse;
    headerKpis: {
      gridFrequencyHz: number;
      ambientTempC: number;
      latencyMs: number;
    };
    recentEvents: Array<{ timestamp: string; status: 'CRITICAL' | 'WARNING'; multiplier: number }>;
    bayStates: Record<number, { state: 'ACTIVE' | 'THROTTLED' | 'SHED' | 'IDLE'; kwDraw: number }>;
  }>({
    predictData: mockPredictResponse,
    explainData: mockExplainResponse,
    simulateData: mockSimulateResponse,
    headerKpis: {
      gridFrequencyHz: 49.92,
      ambientTempC: 36.5,
      latencyMs: 0.48,
    },
    recentEvents: [],
    bayStates: {
      1: { state: 'THROTTLED', kwDraw: 60.0 },
      2: { state: 'ACTIVE', kwDraw: 25.0 },
      3: { state: 'THROTTLED', kwDraw: 60.0 },
      4: { state: 'SHED', kwDraw: 0.0 },
      5: { state: 'ACTIVE', kwDraw: 24.5 },
      6: { state: 'ACTIVE', kwDraw: 26.2 },
      7: { state: 'SHED', kwDraw: 0.0 },
      8: { state: 'IDLE', kwDraw: 0.0 },
    }
  });

  useEffect(() => {
    const interval = setInterval(() => {
      if (isPaused) return;
      
      setMockData(prev => {
        // Grid frequency: 49.85 - 50.15 (smooth random walk)
        const freqDelta = (Math.random() - 0.5) * 0.04;
        const newFreq = Math.max(49.85, Math.min(50.15, prev.headerKpis.gridFrequencyHz + freqDelta));

        // Ambient temp: 28 - 40 (smooth random walk)
        const tempDelta = (Math.random() - 0.5) * 0.2;
        const newTemp = Math.max(28, Math.min(40, prev.headerKpis.ambientTempC + tempDelta));

        // Latency jitter
        const newLatency = Math.max(0.2, prev.headerKpis.latencyMs + (Math.random() - 0.5) * 0.1);

        // 24h timeline update
        const newTimeline = [...prev.simulateData.timeline];
        const lastIndex = newTimeline.length - 1;
        const lastPoint = newTimeline[lastIndex];
        
        // Random walk for load
        const loadDelta = (Math.random() - 0.5) * 8;
        const newSimulatedKw = Math.max(0, lastPoint.simulated_kw + loadDelta);
        const newBaselineKw = Math.max(0, lastPoint.baseline_kw + loadDelta * 0.5);
        
        // We just update the latest point for simplicity and animation smoothness
        newTimeline[lastIndex] = {
          ...lastPoint,
          simulated_kw: newSimulatedKw,
          baseline_kw: newBaselineKw,
        };

        const capacityUtilizationPct = (newSimulatedKw / prev.predictData.transformer_capacity_kw) * 100;
        const surgeStatus = capacityUtilizationPct > 85 ? 'CRITICAL' : (capacityUtilizationPct > 70 ? 'WARNING' : 'NORMAL');
        const prevSurgeStatus = prev.predictData.surge_status;

        // Update recommended actions based on surge status
        const recommendedActions = { ...prev.predictData.recommended_actions };
        if (surgeStatus === 'CRITICAL') {
          recommendedActions.throttle_active = true;
          recommendedActions.shed_stalls = [4, 7];
          recommendedActions.per_stall_cap_kw = 40.0;
        } else {
          recommendedActions.throttle_active = false;
          recommendedActions.shed_stalls = [];
          recommendedActions.per_stall_cap_kw = 60.0;
        }

        // Track surge events
        let newRecentEvents = [...prev.recentEvents];
        if (surgeStatus !== 'NORMAL' && prevSurgeStatus !== surgeStatus) {
          newRecentEvents.unshift({
            timestamp: new Date().toISOString(),
            status: surgeStatus,
            multiplier: prev.simulateData.dispatched_mitigations.dynamic_tariff_multiplier
          });
          // Keep only the last 5 events
          if (newRecentEvents.length > 5) {
            newRecentEvents = newRecentEvents.slice(0, 5);
          }
        }

        // 8 independent bay kW values, randomly flip one occasionally
        const newBayStates = { ...prev.bayStates };
        for (let i = 1; i <= 8; i++) {
          let bay = { ...newBayStates[i] };
          
          // Occasional state flip (10% chance per tick)
          if (Math.random() < 0.1) {
            const states: Array<'ACTIVE' | 'THROTTLED' | 'IDLE'> = ['ACTIVE', 'THROTTLED', 'IDLE']; // leave SHED as managed by API usually, but let's randomize
            if (bay.state !== 'SHED') {
              bay.state = states[Math.floor(Math.random() * states.length)];
            }
          }
          
          // Vary kW draw slightly if ACTIVE or THROTTLED
          if (bay.state === 'ACTIVE') {
            bay.kwDraw = Math.max(15, Math.min(30, bay.kwDraw + (Math.random() - 0.5) * 2));
          } else if (bay.state === 'THROTTLED') {
            bay.kwDraw = Math.max(40, Math.min(prev.predictData.recommended_actions.per_stall_cap_kw, bay.kwDraw + (Math.random() - 0.5) * 3));
          } else {
            bay.kwDraw = 0;
          }
          
          newBayStates[i] = bay;
        }

        return {
          ...prev,
          headerKpis: {
            gridFrequencyHz: newFreq,
            ambientTempC: newTemp,
            latencyMs: newLatency,
          },
          predictData: {
            ...prev.predictData,
            predicted_load_kw: newSimulatedKw,
            capacity_utilization_pct: capacityUtilizationPct,
            surge_status: surgeStatus,
            recommended_actions: recommendedActions,
          },
          simulateData: {
            ...prev.simulateData,
            simulated_peak_kw: newSimulatedKw,
            timeline: newTimeline,
            surge_risk: surgeStatus,
          },
          bayStates: newBayStates,
          recentEvents: newRecentEvents,
        };
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [isPaused]);

  return mockData;
}
