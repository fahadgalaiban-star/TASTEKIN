// Connectivity for the native shell. `@capacitor/network` reports the
// device's real reachability (Wi-Fi / cellular / none) and fires on
// changes; `navigator.onLine` is the fallback and the only source in the
// browser. The hook is a no-op (always online) unless `enabled`, so the web
// build keeps its current behaviour.
import { Network } from '@capacitor/network';
import { useEffect, useState } from 'react';

export type ConnectivityState = { online: boolean; known: boolean };

/** Reads the plugin's status once; falls back to navigator.onLine. */
async function readNativeStatus(): Promise<boolean> {
  try {
    const status = await Network.getStatus();
    return status.connected;
  } catch {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }
}

/**
 * Tracks connectivity while `enabled`. `known` turns true after the first
 * real reading, so a screen can avoid flashing "offline" before the plugin
 * has answered.
 */
export function useConnectivity(enabled: boolean): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>({ online: true, known: !enabled });
  useEffect(() => {
    if (!enabled) { setState({ online: true, known: true }); return; }
    let active = true;
    void readNativeStatus().then((online) => { if (active) setState({ online, known: true }); });
    const onBrowser = () => { if (active) setState({ online: navigator.onLine, known: true }); };
    window.addEventListener('online', onBrowser);
    window.addEventListener('offline', onBrowser);
    const listener = Network.addListener('networkStatusChange', (status) => {
      if (active) setState({ online: status.connected, known: true });
    });
    return () => {
      active = false;
      window.removeEventListener('online', onBrowser);
      window.removeEventListener('offline', onBrowser);
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [enabled]);
  return state;
}
