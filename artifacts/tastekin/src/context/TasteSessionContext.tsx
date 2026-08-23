import React, { createContext, useContext } from 'react';

type TasteSessionSnapshot = {
  status: 'loading' | 'authenticated' | 'signed-out';
  user: { id: string; email: string | null } | null;
  role: 'creator' | 'consumer';
  creator: { handle: string; displayName: string; verified: boolean; ownsWorkspace: boolean } | null;
  revision: number;
};

type TasteSession = TasteSessionSnapshot & { refresh: () => Promise<void> };

const TasteSessionContext = createContext<TasteSession | null>(null);

export function useTasteSession() {
  const session = useContext(TasteSessionContext);
  if (!session) throw new Error('Taste session is unavailable outside the TASTEKIN app.');
  return session;
}

export default TasteSessionContext;
