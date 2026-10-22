import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import type { PredictResponse, ExplainResponse, SimulateResponse, MetricsResponse } from '../types/telemetry';
import { useMockTelemetry } from '../hooks/useMockTelemetry';

export interface ToastMessage {
  id: string;
  type: 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
}

export interface SystemSettings {
  warningThresholdPct: number;
  criticalThresholdPct: number;
  transformerCapacityKw: number;
}

interface DataContextType {
  settings: SystemSettings;
  updateSettings: (newSettings: Partial<SystemSettings>) => void;
  predictData: PredictResponse | null;
  explainData: ExplainResponse | null;
  simulateData: SimulateResponse | null;
  metricsData: MetricsResponse | null;
  headerKpis: {
    gridFrequencyHz: number;
    ambientTempC: number;
    latencyMs: number;
  };
  bayStates: Record<number, { state: 'ACTIVE' | 'THROTTLED' | 'SHED' | 'IDLE'; kwDraw: number }>;
  handleSimulate: (params: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  }) => Promise<SimulateResponse>;
  resetSimulation: () => void;
  isLoading: boolean;
  isOffline: boolean;
  isSimulationMode: boolean;
  activeSimulationParams: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  } | null;
  recentEvents: Array<{ timestamp: string; status: 'CRITICAL' | 'WARNING'; multiplier: number }>;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const [predictData, setPredictData] = useState<PredictResponse | null>(null);
  const [explainData, setExplainData] = useState<ExplainResponse | null>(null);
  const [simulateData, setSimulateData] = useState<SimulateResponse | null>(null);
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [activeSimulationParams, setActiveSimulationParams] = useState<{
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  } | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [globalRecentEvents, setGlobalRecentEvents] = useState<Array<{ timestamp: string; status: 'CRITICAL' | 'WARNING'; multiplier: number }>>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [settings, setSettings] = useState<SystemSettings>({
    warningThresholdPct: 65,
    criticalThresholdPct: 80,
    transformerCapacityKw: 250,
  });
  const prevSurgeRisk = useRef<string>('NORMAL');

  const updateSettings = (newSettings: Partial<SystemSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const mockTelemetry = useMockTelemetry(isSimulationMode || isPaused);

  const loadBaseData = async () => {
    try {
      const [pRes, eRes, sRes, mRes] = await Promise.all([
        api.predict(),
        api.explain(),
        api.simulate({ temp_delta_c: 0, traffic_surge_pct: 0, forced_outage_stalls: [] }),
        api.metrics(),
      ]);
      setPredictData(pRes);
      setExplainData(eRes);
      setSimulateData(sRes);
      setMetricsData(mRes);
      setIsOffline(false);
    } catch (error) {
      console.warn('Failed to load data from backend, falling back to mock telemetry');
      setIsOffline(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBaseData();
  }, []);

  const handleSimulate = async (params: {
    temp_delta_c: number;
    traffic_surge_pct: number;
    forced_outage_stalls: number[];
  }) => {
    try {
      const sRes = await api.simulate(params);
      setSimulateData(sRes);
      setActiveSimulationParams(params);
      setIsSimulationMode(true);
      setIsOffline(false);
      return sRes;
    } catch (error) {
      console.warn('Backend unavailable, using mock data for simulate');
      setIsOffline(true);
      setActiveSimulationParams(params);
      setIsSimulationMode(true);
      return mockTelemetry.simulateData;
    }
  };

  const resetSimulation = async () => {
    setIsSimulationMode(false);
    setActiveSimulationParams(null);
    try {
      const sRes = await api.simulate({ temp_delta_c: 0, traffic_surge_pct: 0, forced_outage_stalls: [] });
      setSimulateData(sRes);
    } catch (error) {
      // Ignore in offline mode, it will reset naturally on next live tick
    }
  };

  const currentPredict = isOffline ? mockTelemetry.predictData : predictData;
  const currentExplain = isOffline ? mockTelemetry.explainData : explainData;
  const currentSimulate = isOffline && !isSimulationMode ? mockTelemetry.simulateData : simulateData;

  const outPredict = currentPredict ? JSON.parse(JSON.stringify(currentPredict)) as PredictResponse : null;
  const outSimulate = currentSimulate ? JSON.parse(JSON.stringify(currentSimulate)) as SimulateResponse : null;

  // Apply setting overrides
  if (outPredict) {
    outPredict.transformer_capacity_kw = settings.transformerCapacityKw;
    const peakKw = outPredict.predicted_load_kw;
    const capacityPct = (peakKw / settings.transformerCapacityKw) * 100;
    
    if (capacityPct >= settings.criticalThresholdPct) {
      outPredict.surge_status = 'CRITICAL';
    } else if (capacityPct >= settings.warningThresholdPct) {
      outPredict.surge_status = 'WARNING';
    } else {
      outPredict.surge_status = 'NORMAL';
    }
  }

  if (outSimulate) {
    const peakKw = outSimulate.simulated_peak_kw;
    const capacityPct = (peakKw / settings.transformerCapacityKw) * 100;
    
    if (capacityPct >= settings.criticalThresholdPct) {
      outSimulate.surge_risk = 'CRITICAL';
    } else if (capacityPct >= settings.warningThresholdPct) {
      outSimulate.surge_risk = 'WARNING';
    } else {
      outSimulate.surge_risk = 'NORMAL';
    }
  }

  const activeSurgeRisk = outSimulate?.surge_risk || outPredict?.surge_status;
  const activeMultiplier = outSimulate?.dispatched_mitigations.dynamic_tariff_multiplier;

  useEffect(() => {
    if (activeSurgeRisk && activeSurgeRisk !== 'NORMAL' && activeSurgeRisk !== prevSurgeRisk.current) {
      const now = new Date().toISOString();
      const status = activeSurgeRisk as 'CRITICAL' | 'WARNING';
      const multiplier = activeMultiplier || 1.0;
      const capacityPct = Math.round(
        ((outSimulate?.simulated_peak_kw || outPredict?.predicted_load_kw || 0) / settings.transformerCapacityKw) * 100
      );
      
      setGlobalRecentEvents(prev => {
        const newEvent = { timestamp: now, status, multiplier };
        return [newEvent, ...prev]; // Keep all session history
      });

      // Emit toast
      const toastId = Math.random().toString(36).substring(7);
      const title = status === 'CRITICAL' ? 'CRITICAL SURGE' : 'ELEVATED RISK';
      const throttledBays = outSimulate?.dispatched_mitigations.throttled_stalls.length || 0;
      const message = status === 'CRITICAL' 
        ? `Capacity hit ${capacityPct}%. Tariff x${multiplier.toFixed(2)} active, ${throttledBays} bays throttled.`
        : `Load rising — ${capacityPct}% capacity, tariff x${multiplier.toFixed(2)} active.`;

      setToasts(prev => {
        const newToasts = [{ id: toastId, type: status, title, message }, ...prev].slice(0, 3);
        return newToasts;
      });

      // Auto dismiss
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toastId));
      }, 5000);
    }
    
    if (activeSurgeRisk) {
      prevSurgeRisk.current = activeSurgeRisk;
    }
  }, [activeSurgeRisk, activeMultiplier, outSimulate, outPredict, settings.transformerCapacityKw]);

  // Derive bay states in simulation mode
  const currentBayStates = { ...mockTelemetry.bayStates };
  if (isSimulationMode && activeSimulationParams && outSimulate && outPredict) {
    const forced = activeSimulationParams.forced_outage_stalls;
    const throttled = outSimulate.dispatched_mitigations.throttled_stalls;
    
    // Override recommended actions for the UI
    outPredict.recommended_actions.throttle_active = throttled.length > 0;
    outPredict.recommended_actions.shed_stalls = forced || [];

    // Clear all existing overrides, let them be ACTIVE or IDLE natively
    for (let i = 1; i <= 8; i++) {
      if (forced.includes(i)) {
        currentBayStates[i] = { state: 'SHED', kwDraw: 0.0 };
      } else if (throttled.includes(i)) {
        currentBayStates[i] = { state: 'THROTTLED', kwDraw: outPredict.recommended_actions.per_stall_cap_kw || 60.0 };
      }
    }
  }

  return (
    <DataContext.Provider
      value={{
        settings,
        updateSettings,
        predictData: outPredict,
        explainData: currentExplain,
        simulateData: outSimulate,
        metricsData,
        headerKpis: mockTelemetry.headerKpis,
        bayStates: currentBayStates,
        handleSimulate,
        resetSimulation,
        isLoading,
        isOffline,
        isSimulationMode,
        activeSimulationParams,
        recentEvents: globalRecentEvents,
        isPaused,
        setIsPaused,
        toasts,
        dismissToast: (id: string) => setToasts(prev => prev.filter(t => t.id !== id)),
        addToast: (toast: Omit<ToastMessage, 'id'>) => {
          const id = Math.random().toString(36).substring(7);
          setToasts(prev => [{ ...toast, id }, ...prev].slice(0, 3));
          setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
          }, 5000);
        }
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
