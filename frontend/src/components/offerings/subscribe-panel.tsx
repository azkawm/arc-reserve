import { formatUnits, parseEventLogs } from "viem";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import {
  MUSD_DECIMALS,
  TOKEN_DECIMALS,
  addressesFor,
  erc20Abi,
  identityAbi,
  offeringAbi,
} from "@/lib/contracts";
import { formatAmount, toBaseUnits } from "@/lib/format";
import { describeRevert } from "@/lib/revert";
import { useChainGuard } from "@/lib/use-chain-guard";
import { useTx } from "@/lib/use-tx";

const SLIPPAGE_BPS = 50;

/**
 * Primary subscription. Approves the **offering** (not the vault), computes the minimum token
 * output from the immutable offering price minus a visible tolerance, and confirms on
 * `TokensPurchased`. Buying requires a verified wallet — the token is permissioned.
 */
export function SubscribePanel({ symbol, price }: { symbol: string; price: string }) {
  const { chainId } = useChain();
  const deployment = addressesFor(chainId);
  const guard = useChainGuard();
  const { address, isConnected } = useAccount();
  const tx = useTx();
  const [amount, setAmount] = useState("");

  const amountValid = /^\d+(\.\d+)?$/.test(amount) && toBaseUnits(amount, MUSD_DECIMALS) > 0n;
  const amountRaw = amountValid ? toBaseUnits(amount, MUSD_DECIMALS) : 0n;

  const balance = useReadContract({
    address: deployment.mockUSD,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });
  const allowance = useReadContract({
    address: deployment.mockUSD,
    abi: erc20Abi,
    functionName: "allowance",
    args: address === undefined ? undefined : [address, deployment.offering],
    query: { enabled: isConnected && address !== undefined },
  });
  const verified = useReadContract({
    address: deployment.identityRegistry,
    abi: identityAbi,
    functionName: "isVerified",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });

  // `useTx` invalidates the react-query `["api"]` family, but these ERC-20 reads are wagmi reads
  // and are not part of it. Re-read allowance and balance when a receipt confirms, so the button
  // advances from "Approve mUSD" to "Subscribe" instead of staying on the approval step.
  const refetchAllowance = allowance.refetch;
  const refetchBalance = balance.refetch;
  useEffect(() => {
    if (!tx.receipt.isSuccess) return;
    void refetchAllowance();
    void refetchBalance();
  }, [tx.receipt.isSuccess, refetchAllowance, refetchBalance]);

  // Tokens out from the offering price: mUSD (6dp) / price (6dp per token) => tokens (18dp).
  const tokensOutRaw = useMemo(() => {
    const priceRaw = toBaseUnits(price, MUSD_DECIMALS);
    if (priceRaw === 0n) return 0n;
    return (amountRaw * 10n ** BigInt(TOKEN_DECIMALS)) / priceRaw;
  }, [amountRaw, price]);

  const outcome = useMemo(() => {
    const data = tx.receipt.data;
    if (!tx.receipt.isSuccess || data === undefined) return null;
    const [event] = parseEventLogs({ abi: offeringAbi, logs: data.logs, eventName: "TokensPurchased" });
    if (event === undefined) return "Purchase confirmed.";
    return `Bought ${formatAmount(formatUnits(event.args.tokenAmount, TOKEN_DECIMALS), 4)} ${symbol} for ${formatAmount(
      formatUnits(event.args.stablecoinAmount, MUSD_DECIMALS),
    )} mUSD`;
  }, [tx.receipt.isSuccess, tx.receipt.data, symbol]);

  const allowanceEnough = allowance.data !== undefined && allowance.data >= amountRaw;
  const balanceEnough = balance.data === undefined || balance.data >= amountRaw;

  const blocked = !isConnected
    ? "Connect wallet to subscribe"
    : !guard.isCorrect
      ? `Switch to ${chainName(guard.expectedChainId)}`
      : verified.data !== true
        ? "Verify your wallet to subscribe"
        : !amountValid
          ? "Enter an amount"
          : !balanceEnough
            ? "Insufficient mUSD"
            : null;

  const busy = tx.isPending || tx.receipt.isLoading;

  function onApprove() {
    tx.writeContract({
      address: deployment.mockUSD,
      abi: erc20Abi,
      functionName: "approve",
      args: [deployment.offering, amountRaw],
    });
  }

  function onBuy() {
    const minimumTokensOut = (tokensOutRaw * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
    tx.writeContract({
      address: deployment.offering,
      abi: offeringAbi,
      functionName: "buy",
      args: [amountRaw, minimumTokensOut],
    });
  }

  return (
    <section className="bg-linen/60 space-y-2 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-ink text-sm font-medium">Subscribe to {symbol}</h3>
        <span className="text-ash text-[11px]">{formatAmount(price, 6)} mUSD / token</span>
      </div>
      <label className="block space-y-1">
        <span className="text-ash text-[11px]">Amount (mUSD)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.0"
          className="border-mist bg-paper text-ink focus-visible:ring-cerulean h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        />
        <span className="text-ash text-[11px]">
          Balance {balance.data === undefined ? "—" : formatAmount(formatUnits(balance.data, MUSD_DECIMALS))} mUSD
          {" · "}
          You receive ≈ {tokensOutRaw === 0n ? "—" : formatAmount(formatUnits(tokensOutRaw, TOKEN_DECIMALS), 4)} {symbol}
        </span>
      </label>

      {blocked !== null ? (
        <Button className="w-full" size="sm" disabled>
          {blocked}
        </Button>
      ) : !allowanceEnough ? (
        <Button className="w-full" size="sm" disabled={busy} onClick={onApprove}>
          {busy ? "Approving…" : "Approve mUSD"}
        </Button>
      ) : (
        <Button className="w-full" size="sm" disabled={busy} onClick={onBuy}>
          {busy ? "Subscribing…" : `Subscribe with ${amount} mUSD`}
        </Button>
      )}

      {tx.error !== null && <p className="text-destructive text-[11px]">{describeRevert(tx.error)}</p>}
      {outcome !== null && <p className="text-provenance-live text-[11px]">{outcome}</p>}
    </section>
  );
}
