import { formatUnits } from "viem";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import type { AssetMetrics, AssetStatus } from "@/lib/api";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import { TOKEN_DECIMALS, addressesFor, redemptionAbi } from "@/lib/contracts";
import { formatAmount, formatRelative, toBaseUnits } from "@/lib/format";
import { describeRevert } from "@/lib/revert";
import { useAccountPosition } from "@/lib/queries";
import { useChainGuard } from "@/lib/use-chain-guard";
import { useTx } from "@/lib/use-tx";

const SLIPPAGE_BPS = 50;
const MODE_NORMAL = 0;

/**
 * Redemption. The quote is `min(NAV, backing)` — **not** the floor the reference shows. The token
 * is burned under the controller's role, so there is no approval step. The per-period allowance
 * is denominated in **tokens**, and the NAV's age is shown because nothing on chain blocks a stale
 * NAV from pricing a redemption (D-039).
 */
export function RedemptionPanel({
  assetId,
  symbol,
  m,
  status,
}: {
  assetId: string;
  symbol: string;
  m: AssetMetrics;
  status: AssetStatus;
}) {
  const { chainId } = useChain();
  const deployment = addressesFor(chainId);
  const guard = useChainGuard();
  const { address, isConnected } = useAccount();
  const position = useAccountPosition(address, assetId);
  const tx = useTx();
  const [amount, setAmount] = useState("");

  const account = position.data?.data;
  const price = account?.redemptionQuote?.price ?? m.redemptionPrice.normal;
  const amountValid = /^\d+(\.\d+)?$/.test(amount) && toBaseUnits(amount, TOKEN_DECIMALS) > 0n;

  const receive =
    amountValid && price !== null
      ? (toBaseUnits(amount, TOKEN_DECIMALS) * toBaseUnits(price, 6)) / 10n ** BigInt(TOKEN_DECIMALS)
      : null;

  const blocked = (() => {
    if (!isConnected) return "Connect wallet to redeem";
    if (!guard.isCorrect) return `Switch to ${chainName(guard.expectedChainId)}`;
    if (status !== "Active") return `Asset is ${status.toLowerCase()}`;
    if (account?.issuerAllocation === true) return "Issuer allocation cannot be redeemed";
    if (account?.frozen === true) return "Tokens are frozen";
    if (price === null) return "No redemption price available";
    if (!amountValid) return "Enter an amount";
    return null;
  })();

  function onRedeem() {
    if (price === null) return;
    const tokenAmount = toBaseUnits(amount, TOKEN_DECIMALS);
    const minOut = (receive ?? 0n) === 0n ? 0n : ((receive ?? 0n) * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
    tx.writeContract({
      address: deployment.redemptionController,
      abi: redemptionAbi,
      functionName: "redeem",
      args: [tokenAmount, minOut, MODE_NORMAL],
    });
  }

  return (
    <section className="bg-paper border-mist space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-ink text-lg">Redeem</h2>
        <span className="text-provenance-mock text-[11px]">
          NAV {formatRelative(m.nav.timestamp)}
          {m.nav.stale ? " · stale" : ""}
        </span>
      </div>

      <div className="bg-linen/60 rounded-lg px-3 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-ash">Price</span>
          <span className="text-ink font-medium">
            {price === null ? "—" : `${formatAmount(price, 6)} mUSD`}
          </span>
        </div>
        <p className="text-ash mt-1">min(NAV, backing) — not the published floor.</p>
      </div>

      <label className="block space-y-1">
        <span className="text-ash text-[11px]">Tokens to redeem</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.0"
          className="border-mist bg-paper text-ink focus-visible:ring-cerulean h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        />
        {account?.redemptionQuote != null && (
          <span className="text-ash text-[11px]">
            Remaining this period: {formatAmount(account.redemptionQuote.maxTokensThisPeriod, 4)} {symbol}
          </span>
        )}
      </label>

      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ash">You receive (est.)</span>
        <span className="text-ink font-medium">
          {receive === null ? "—" : `${formatUnits(receive, 6)} mUSD`}
        </span>
      </div>

      <Button className="w-full" disabled={blocked !== null || tx.isPending || tx.receipt.isLoading} onClick={onRedeem}>
        {tx.isPending || tx.receipt.isLoading ? "Redeeming…" : (blocked ?? "Redeem")}
      </Button>
      {tx.error !== null && (
        <p className="text-destructive text-[11px]">{describeRevert(tx.error)}</p>
      )}
      <p className="text-ash text-[11px]">
        No approval step: the controller burns the tokens. Subject to the per-day period limit and
        available reserve liquidity.
      </p>
    </section>
  );
}

