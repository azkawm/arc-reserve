import { createContext, useContext } from "react";
import { HEDERA_CHAIN_ID } from "@/lib/chains";
import { isProductChainId } from "@/lib/deployments";

/**
 * The active chain, defaulting to Hedera testnet.
 *
 * Chain is explicit state, never inferred from the wallet: the page and the wallet can disagree,
 * and the chain guard (`lib/use-chain-guard.ts`) resolves that at write time. The context object
 * lives here (no JSX) so the provider component can own the state and this module can stay a
 * plain hook module — which keeps React Fast Refresh working for `ChainProvider`.
 */
export interface ChainContextValue {
  /** The chain the portal is reading and writing for. */
  chainId: number;
  /** Switch the portal's chain. Non-product chains (for example Anvil in a stray URL) are ignored. */
  setChainId: (chainId: number) => void;
}

export const ChainContext = createContext<ChainContextValue | null>(null);

export function initialChainId(): number {
  if (typeof window === "undefined") return HEDERA_CHAIN_ID;
  const raw = new URLSearchParams(window.location.search).get("chainId");
  const parsed = raw === null ? Number.NaN : Number(raw);
  return isProductChainId(parsed) ? parsed : HEDERA_CHAIN_ID;
}

export function useChain(): ChainContextValue {
  const context = useContext(ChainContext);
  if (context === null) {
    throw new Error("useChain must be used within a ChainProvider");
  }
  return context;
}
