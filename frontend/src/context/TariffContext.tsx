import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SimulationParams {
  tempDelta: number;
  trafficSurgePct: number;
  outageStalls: number;
}

export const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  tempDelta: 0,
  trafficSurgePct: 0,
  outageStalls: 0,
};

export interface TariffContextType {
  baseSurgeMultiplier: number;
  isSimulationActive: boolean;
  simulationParams: SimulationParams;
  setSimulationParams: React.Dispatch<React.SetStateAction<SimulationParams>>;
  setTempDelta: (tempDelta: number) => void;
  setTrafficSurgePct: (trafficSurgePct: number) => void;
  setOutageStalls: (outageStalls: number) => void;
  setIsSimulationActive: (active: boolean) => void;
  setSimulationTariff: (multiplier: number, params?: SimulationParams) => void;
  resetToLive: (liveMultiplier: number) => void;
}

const TariffContext = createContext<TariffContextType | undefined>(undefined);

export function TariffProvider({ children }: { children: ReactNode }) {
  const [baseSurgeMultiplier, setBaseSurgeMultiplier] = useState<number>(1.0);
  const [isSimulationActive, setIsSimulationActive] = useState<boolean>(false);
  const [simulationParams, setSimulationParams] = useState<SimulationParams>(DEFAULT_SIMULATION_PARAMS);

  const setTempDelta = (tempDelta: number) => {
    setSimulationParams(prev => ({ ...prev, tempDelta }));
  };

  const setTrafficSurgePct = (trafficSurgePct: number) => {
    setSimulationParams(prev => ({ ...prev, trafficSurgePct }));
  };

  const setOutageStalls = (outageStalls: number) => {
    setSimulationParams(prev => ({ ...prev, outageStalls }));
  };

  const setSimulationTariff = (multiplier: number, params?: SimulationParams) => {
    setBaseSurgeMultiplier(multiplier);
    if (params) {
      setSimulationParams(params);
    }
    setIsSimulationActive(true);
  };

  const resetToLive = (liveMultiplier: number) => {
    setBaseSurgeMultiplier(liveMultiplier);
    setSimulationParams(DEFAULT_SIMULATION_PARAMS);
    setIsSimulationActive(false);
  };

  return (
    <TariffContext.Provider
      value={{
        baseSurgeMultiplier,
        isSimulationActive,
        simulationParams,
        setSimulationParams,
        setTempDelta,
        setTrafficSurgePct,
        setOutageStalls,
        setIsSimulationActive,
        setSimulationTariff,
        resetToLive,
      }}
    >
      {children}
    </TariffContext.Provider>
  );
}

export function useTariff() {
  const context = useContext(TariffContext);
  if (context === undefined) {
    throw new Error('useTariff must be used within a TariffProvider');
  }
  return context;
}
