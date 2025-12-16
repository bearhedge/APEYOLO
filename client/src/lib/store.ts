import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  googleConnected: boolean;
  setGoogleConnected: (connected: boolean) => void;
}

interface BrokerState {
  ibkrConnected: boolean;
  lastDiag: {
    oauth: number | null;
    sso: number | null;
    init: number | null;
    traceId?: string;
  } | null;
  setIBKRConnected: (connected: boolean) => void;
  setLastDiag: (diag: BrokerState['lastDiag']) => void;
}

interface AgentState {
  status: 'stopped' | 'running' | 'error';
  strategy: string;
  symbols: string[];
  setStatus: (status: AgentState['status']) => void;
  setStrategy: (strategy: string) => void;
  setSymbols: (symbols: string[]) => void;
}

interface RiskState {
  aggression: number;
  maxLeverage: number;
  maxDailyLoss: number;
  maxPerSymbol: number;
  setAggression: (value: number) => void;
  setMaxLeverage: (value: number) => void;
  setMaxDailyLoss: (value: number) => void;
  setMaxPerSymbol: (value: number) => void;
}

interface AppState extends AuthState, BrokerState, AgentState, RiskState {}

export const useStore = create<AppState & { hasHydrated: boolean }>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      googleConnected: false,
      setGoogleConnected: (connected) => set({ googleConnected: connected }),

      ibkrConnected: false,
      lastDiag: null,
      setIBKRConnected: (connected) => set({ ibkrConnected: connected }),
      setLastDiag: (diag) => set({ lastDiag: diag }),

      status: 'stopped',
      strategy: 'CSP',
      symbols: [],
      setStatus: (status) => set({ status }),
      setStrategy: (strategy) => set({ strategy }),
      setSymbols: (symbols) => set({ symbols }),

      aggression: 50,
      maxLeverage: 2,
      maxDailyLoss: 5,
      maxPerSymbol: 10000,
      setAggression: (aggression) => set({ aggression }),
      setMaxLeverage: (maxLeverage) => set({ maxLeverage }),
      setMaxDailyLoss: (maxDailyLoss) => set({ maxDailyLoss }),
      setMaxPerSymbol: (maxPerSymbol) => set({ maxPerSymbol }),
    }),
    {
      name: 'apex-options-store',
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[Zustand] Rehydration error', error);
        }
        // mark store hydrated so views can avoid race conditions
        useStore.setState({ hasHydrated: true });
        // eslint-disable-next-line no-console
        console.log('[Zustand] Hydration complete');
      },
    }
  )
);
