import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChainContext, initialChainId, type ChainContextValue } from "@/lib/chain-context";
import { isProductChainId } from "@/lib/deployments";

/**
 * Holds the active chain. The selection is mirrored into `?chainId=` so the active chain is
 * visible in the route and a link carries it.
 */
export function ChainProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainIdState] = useState<number>(initialChainId);

  const setChainId = useCallback((next: number) => {
    if (!isProductChainId(next)) return;
    setChainIdState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("chainId", String(next));
    window.history.replaceState(null, "", url);
  }, []);

  const value = useMemo<ChainContextValue>(() => ({ chainId, setChainId }), [chainId, setChainId]);

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}
