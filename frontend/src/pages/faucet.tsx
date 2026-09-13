import { Droplet } from "lucide-react";
import { useEffect } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import { MUSD_DECIMALS, addressesFor, erc20Abi } from "@/lib/contracts";
import { formatAmount, shortAddress } from "@/lib/format";
import { describeRevert } from "@/lib/revert";
import { useChainGuard } from "@/lib/use-chain-guard";
import { useTx } from "@/lib/use-tx";

/** `MockUSD.FAUCET_AMOUNT` is 100,000 mUSD (6 decimals), minted by `faucet()`. */
const FAUCET_AMOUNT = 100_000;

/**
 * A dedicated faucet. `MockUSD.faucet()` mints a fixed test balance to the caller, so the only
 * preconditions are a connected wallet on the page's chain. Testnet only — mUSD has no value.
 */
export function FaucetPage() {
  const { chainId } = useChain();
  const deployment = addressesFor(chainId);
  const guard = useChainGuard();
  const { address, isConnected } = useAccount();
  const tx = useTx();

  const balance = useReadContract({
    address: deployment.mockUSD,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });
  const refetchBalance = balance.refetch;
  useEffect(() => {
    if (tx.receipt.isSuccess) void refetchBalance();
  }, [tx.receipt.isSuccess, refetchBalance]);

  const busy = tx.isPending || tx.receipt.isLoading;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-2">
        <h1 className="font-display text-ink text-3xl tracking-tight">Test mUSD faucet</h1>
        <p className="text-charcoal text-sm">
          Mint free MockUSD (mUSD) on {chainName(chainId)}. mUSD is the product's 6-decimal test
          stablecoin; it has no value and moves no real funds.
        </p>
      </header>

      <section className="bg-paper border-mist space-y-4 rounded-xl border p-4">
        <dl className="space-y-1.5 text-xs">
          <Row label="Network" value={chainName(chainId)} />
          <Row label="mUSD token" value={shortAddress(deployment.mockUSD)} />
          <Row
            label="Faucet amount"
            value={`${formatAmount(String(FAUCET_AMOUNT), 0)} mUSD`}
          />
          <Row
            label="Your balance"
            value={
              !isConnected || balance.data === undefined
                ? "—"
                : `${formatAmount(formatUnits(balance.data, MUSD_DECIMALS))} mUSD`
            }
          />
        </dl>

        {!isConnected ? (
          <Button className="w-full" disabled>
            Connect a wallet to use the faucet
          </Button>
        ) : !guard.isCorrect ? (
          <Button className="w-full" onClick={guard.switchToExpected}>
            Switch to {chainName(guard.expectedChainId)}
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={busy}
            onClick={() =>
              tx.writeContract({
                address: deployment.mockUSD,
                abi: erc20Abi,
                functionName: "faucet",
              })
            }
          >
            <Droplet size={16} aria-hidden="true" />
            {busy ? "Minting…" : `Get ${formatAmount(String(FAUCET_AMOUNT), 0)} mUSD`}
          </Button>
        )}

        {tx.error !== null && (
          <p className="text-destructive text-[11px]">{describeRevert(tx.error)}</p>
        )}
        {tx.receipt.isSuccess && (
          <p className="text-provenance-live text-[11px]">
            Minted {formatAmount(String(FAUCET_AMOUNT), 0)} mUSD. The balance above refreshes on the
            receipt.
          </p>
        )}
      </section>

      <p className="text-ash text-sm">
        Next:{" "}
        <a className="text-cerulean-deep underline" href="/offerings">
          open the offerings
        </a>{" "}
        or{" "}
        <a className="text-cerulean-deep underline" href="/assets/solar-indonesia-01">
          go to the swap desk
        </a>
        .
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ash">{label}</dt>
      <dd className="text-ink font-medium">{value}</dd>
    </div>
  );
}
