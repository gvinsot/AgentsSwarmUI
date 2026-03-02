import React, { createContext, useContext, useMemo, useState } from 'react';

interface AppContextValue {
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const value = useMemo(
    () => ({
      selectedAgentId,
      setSelectedAgentId,
    }),
    [selectedAgentId]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return ctx;
}