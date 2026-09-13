import { Droplet } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { useChain } from "@/lib/chain-context";
import { addressesFor, erc20Abi } from "@/lib/contracts";
import { describeRevert } from "@/lib/revert";
import { useChainGuard } from "@/lib/use-chain-guard";
import { useTx } from "@/lib/use-tx";

/**
 * Test mUSD. Any wallet can mint, and it is the first step of the judge journey. Shown only when
 * the wallet is on the page's chain, so it never mints against the wrong deployment.
 */
export function FaucetButton() {
  const { chainId } = useChain();
  const guard = useChainGuard();
  const { isConnected } = useAccount();
  const tx = useTx();

  if (!isConnected || !guard.isCorrect) return null;

  const deployment = addressesFor(chainId);
  const busy = tx.isPending || tx.receipt.isLoading;

  return (
    <div className="flex flex-col items-end">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          tx.writeContract({
            address: deployment.mockUSD,
            abi: erc20Abi,
            functionName: "faucet",
          })
        }
      >
        <Droplet size={14} aria-hidden="true" />
        {busy ? "Minting…" : "Get mUSD"}
      </Button>
      {tx.error !== null && <span className="text-destructive text-[10px]">{describeRevert(tx.error)}</span>}
    </div>
  );
}
