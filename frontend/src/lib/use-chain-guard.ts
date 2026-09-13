import { useAccount, useSwitchChain } from "wagmi";
import { useChain } from "@/lib/chain-context";
import { isProductChainId } from "@/lib/deployments";

/**
 * The chain guard that every write consults before it is offered.
 *
 * The page's chain comes from the chain context, never from the wallet. If the wallet is on a
 * different chain the action is blocked and a `switchChain` affordance is offered, so a
 * transaction is never submitted to the wrong deployment (INTEGRATION_GUIDE §2.1).
 */
export interface ChainGuard {
  /** The chain the page is showing. */
  expectedChainId: number;
  /** The chain the wallet is connected to, or `undefined` when disconnected. */
  walletChainId: number | undefined;
  isConnected: boolean;
  /** True only when connected and the wallet's chain equals the page's. */
  isCorrect: boolean;
  switchToExpected: () => void;
  isSwitching: boolean;
}

export function useChainGuard(): ChainGuard {
  const { chainId: expectedChainId } = useChain();
  const { chainId: walletChainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  return {
    expectedChainId,
    walletChainId,
    isConnected,
    isCorrect: isConnected && walletChainId === expectedChainId,
    switchToExpected: () => {
      if (!isProductChainId(expectedChainId)) return;
      switchChain({ chainId: expectedChainId });
    },
    isSwitching: isPending,
  };
}
