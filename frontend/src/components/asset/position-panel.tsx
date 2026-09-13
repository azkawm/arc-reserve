import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { useChain } from "@/lib/chain-context";
import { TOKEN_DECIMALS, addressesFor, revenueAbi } from "@/lib/contracts";
import { formatAmount, toBaseUnits } from "@/lib/format";
import { describeRevert } from "@/lib/revert";
import { useAccountPosition } from "@/lib/queries";
import { useTx } from "@/lib/use-tx";

/**
 * The holder's position. Holdings, spendable balance and accrued revenue come from the account
 * route for display and from the chain (`claimableRevenue`) for the write. Market value is a
 * client-side derivation and is labelled as such; it is never presented as an on-chain figure.
 */
export function PositionPanel({ assetId, symbol, spot }: { assetId: string; symbol: string; spot: string | null }) {
  const { chainId } = useChain();
  const deployment = addressesFor(chainId);
  const { address, isConnected } = useAccount();
  const position = useAccountPosition(address, assetId);
  const tx = useTx();

  const claimable = useReadContract({
    address: deployment.revenueDistributor,
    abi: revenueAbi,
    functionName: "claimableRevenue",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });

  const data = position.data?.data;

  if (!isConnected) {
    return <PanelShell title="Your position">Connect a wallet to see your position.</PanelShell>;
  }
  if (data === undefined) {
    return (
      <PanelShell title="Your position">
        {position.isPending ? "Loading…" : "No position for this wallet."}
      </PanelShell>
    );
  }

  const balanceRaw = toBaseUnits(data.tokenBalance, TOKEN_DECIMALS);
  const spendableRaw = balanceRaw - toBaseUnits(data.frozenTokens, TOKEN_DECIMALS);
  const marketValueRaw =
    spot === null ? null : (balanceRaw * toBaseUnits(spot, 6)) / 10n ** BigInt(TOKEN_DECIMALS);

  return (
    <PanelShell title="Your position">
      <dl className="space-y-1.5 text-xs">
        <Row label="Holding" value={`${formatAmount(data.tokenBalance, 4)} ${symbol}`} />
        <Row
          label="Spendable"
          value={`${formatUnits(spendableRaw, TOKEN_DECIMALS)} ${symbol}`}
          note={data.frozen ? "some tokens frozen" : undefined}
        />
        <Row
          label="Market value (derived)"
          value={marketValueRaw === null ? "—" : `${formatUnits(marketValueRaw, 6)} mUSD`}
        />
        <Row label="Accrued revenue" value={`${formatAmount(data.claimable, 6)} mUSD`} />
      </dl>

      <Button
        className="w-full"
        disabled={tx.isPending || tx.receipt.isLoading || claimable.data === 0n}
        onClick={() =>
          tx.writeContract({
            address: deployment.revenueDistributor,
            abi: revenueAbi,
            functionName: "claimRevenue",
          })
        }
      >
        {tx.isPending || tx.receipt.isLoading ? "Claiming…" : "Claim revenue"}
      </Button>
      {claimable.data === 0n && <p className="text-ash text-[11px]">Nothing to claim yet.</p>}
      {tx.error !== null && (
        <p className="text-destructive text-[11px]">{describeRevert(tx.error)}</p>
      )}
    </PanelShell>
  );
}

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-paper border-mist space-y-3 rounded-xl border p-4">
      <h2 className="font-display text-ink text-lg">{title}</h2>
      <div className="text-charcoal space-y-3 text-xs">{children}</div>
    </section>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ash">
        {label}
        {note !== undefined && <span className="text-provenance-mock"> · {note}</span>}
      </dt>
      <dd className="text-ink font-medium">{value}</dd>
    </div>
  );
}

