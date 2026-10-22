import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SimulationParams {
  tempDelta: number;
  trafficSurgePct: number;
  outageStalls: number;
}

const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  tempDelta: 0,
  trafficSurgePct: 0,
  outageStalls: 0,
};

interface TariffContextType {
  baseSurgeMultiplier: number;
  isSimulationActive: boolean;
  simulationParams: SimulationParams;
  setSimulationTariff: (multiplier: number, params?: SimulationParams) => void;
  resetToLive: (liveMultiplier: number) => void;
}

const TariffContext = createContext<TariffContextType | undefined>(undefined);

export function TariffProvider({ children }: { children: ReactNode }) {
  const [baseSurgeMultiplier, setBaseSurgeMultiplier] = useState<number>(1.0);
  const [isSimulationActive, setIsSimulationActive] = useState<boolean>(false);
  const [simulationParams, setSimulationParams] = useState<SimulationParams>(DEFAULT_SIMULATION_PARAMS);

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
