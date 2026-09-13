import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseEventLogs } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { ApiError, fixtureMode } from "@/lib/api";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import {
  MUSD_DECIMALS,
  TOKEN_DECIMALS,
  addressesFor,
  erc20Abi,
  identityAbi,
  marketManagerAbi,
} from "@/lib/contracts";
import { formatAmount, toBaseUnits, toPlotNumber } from "@/lib/format";
import { describeRevert } from "@/lib/revert";
import { formatSwapSummary } from "@/lib/swap";
import { useSwapQuote } from "@/lib/queries";
import { useChainGuard } from "@/lib/use-chain-guard";
import { useTx } from "@/lib/use-tx";

type Direction = "buy" | "sell";
const SLIPPAGE_OPTIONS = [10, 50, 100] as const;
/** The whole flywheel needs ≥570k execution gas; the wallet estimate can land in the failing
 *  band, so the limit is fixed at 1,000,000 on every chain (plan §W, action 4). */
const SWAP_GAS = 1_000_000n;

/**
 * The swap desk. Reads a live quote first; if the quote is dry it disables the direction rather
 * than letting the wallet reach `InvalidSwapDirection`. Approves the **market manager** (never
 * the pool), shows `amountSpent` and any refund, and sends an explicit gas limit.
 */
export function TradePanel({
  assetId,
  symbol,
  spot,
}: {
  assetId: string;
  symbol: string;
  spot: string | null;
}) {
  const { chainId } = useChain();
  const deployment = addressesFor(chainId);
  const { address, isConnected } = useAccount();
  const guard = useChainGuard();

  const [direction, setDirection] = useState<Direction>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(50);

  const inSymbol = direction === "buy" ? "mUSD" : symbol;
  const outSymbol = direction === "buy" ? symbol : "mUSD";
  const tokenIn = direction === "buy" ? deployment.mockUSD : deployment.token;
  const inDecimals = direction === "buy" ? MUSD_DECIMALS : TOKEN_DECIMALS;
  const outDecimals = direction === "buy" ? TOKEN_DECIMALS : MUSD_DECIMALS;

  const amountValid = /^\d+(\.\d+)?$/.test(amount) && toBaseUnits(amount, inDecimals) > 0n;

  const quote = useSwapQuote(assetId, tokenIn, amountValid ? amount : undefined);

  const balance = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });
  const allowance = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: address === undefined ? undefined : [address, deployment.marketManager],
    query: { enabled: isConnected && address !== undefined },
  });
  const verified = useReadContract({
    address: deployment.identityRegistry,
    abi: identityAbi,
    functionName: "isVerified",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });

  const tx = useTx();

  // These ERC-20 reads are wagmi reads, not part of the react-query `["api"]` family `useTx`
  // invalidates. After an approval confirms, re-read allowance/balance so the button advances
  // from "Approve" to "Swap" instead of staying on the approval step.
  const refetchAllowance = allowance.refetch;
  const refetchBalance = balance.refetch;
  useEffect(() => {
    if (!tx.receipt.isSuccess) return;
    void refetchAllowance();
    void refetchBalance();
  }, [tx.receipt.isSuccess, refetchAllowance, refetchBalance]);

  // Derived from the receipt, not stored: decode `SwapExactInput` on render so the summary always
  // reflects the last confirmed trade without a setState-in-effect cascade.
  const outcome = useMemo(() => {
    const data = tx.receipt.data;
    if (!tx.receipt.isSuccess || data === undefined) return null;
    const [event] = parseEventLogs({
      abi: marketManagerAbi,
      logs: data.logs,
      eventName: "SwapExactInput",
    });
    if (event === undefined) return null;
    const summary = formatSwapSummary({
      amountRequested: event.args.amountRequested,
      amountSpent: event.args.amountSpent,
      amountOut: event.args.amountOut,
      inDecimals,
      outDecimals,
      inSymbol,
      outSymbol,
    });
    return summary.refundText === null ? summary.text : `${summary.text}; ${summary.refundText}`;
  }, [tx.receipt.isSuccess, tx.receipt.data, inDecimals, outDecimals, inSymbol, outSymbol]);

  const amountInRaw = amountValid ? toBaseUnits(amount, inDecimals) : 0n;
  const allowanceEnough = allowance.data !== undefined && allowance.data >= amountInRaw;
  const balanceEnough = balance.data === undefined || balance.data >= amountInRaw;

  const quoteError = quote.error;
  const quoteUnavailable =
    quoteError instanceof ApiError &&
    (quoteError.code === "QUOTE_UNAVAILABLE" ||
      typeof (quoteError.details as { revertedWith?: string } | undefined)?.revertedWith === "string");

  const blocked = blockedReason({
    isConnected,
    chainCorrect: guard.isCorrect,
    expectedChain: guard.expectedChainId,
    verified: verified.data,
    amountValid,
    balanceEnough,
    fixtureMode,
    quotePending: quote.isPending,
    quoteUnavailable,
    hasQuote: quote.data !== undefined,
  });

  const impact = computeImpact(quote.data?.data.amountOut, quote.data?.data.spent, spot);
  const busy = tx.isPending || tx.receipt.isLoading;

  function onApprove() {
    tx.writeContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: "approve",
      args: [deployment.marketManager, amountInRaw],
    });
  }

  function onSwap() {
    const q = quote.data?.data;
    if (q === undefined) return;
    const minOut = (toBaseUnits(q.amountOut, outDecimals) * BigInt(10_000 - slippageBps)) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1_200);
    tx.writeContract({
      address: deployment.marketManager,
      abi: marketManagerAbi,
      functionName: "swapExactInput",
      args: [tokenIn, amountInRaw, minOut, deadline],
      gas: SWAP_GAS,
    });
  }

  return (
    <section className="bg-paper border-mist space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-ink text-lg">Swap / trade</h2>
        <span className="text-ash text-[11px]">fee tier 0.30% · pool</span>
      </div>

      <div className="bg-linen inline-flex rounded-full p-0.5">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={direction === option}
            onClick={() => setDirection(option)}
            className={
              direction === option
                ? "bg-dusk text-paper rounded-full px-3 py-1 text-xs"
                : "text-charcoal rounded-full px-3 py-1 text-xs"
            }
          >
            {option === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
          </button>
        ))}
      </div>

      <label className="block space-y-1">
        <span className="text-ash text-[11px]">You pay ({inSymbol})</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.0"
          className="border-mist bg-paper text-ink focus-visible:ring-cerulean h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        />
        <span className="text-ash text-[11px]">
          Balance {balance.data === undefined ? "—" : formatAmount(formatUnits(balance.data, inDecimals))} {inSymbol}
        </span>
      </label>

      <div className="bg-linen/60 space-y-1 rounded-lg px-3 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-ash">You receive (est.)</span>
          <span className="text-ink font-medium">
            {quote.data !== undefined
              ? `${formatAmount(quote.data.data.amountOut)} ${outSymbol}`
              : quote.isPending && !fixtureMode
                ? "quoting…"
                : "—"}
          </span>
        </div>
        {quote.data?.data.partialFill === true && (
          <div className="text-provenance-mock">
            Partial fill: only {formatAmount(quote.data.data.spent)} {inSymbol} of your {amount} would be
            spent; the rest is refunded.
          </div>
        )}
        {impact !== null && (
          <div className="flex justify-between">
            <span className="text-ash">Price vs spot</span>
            <span className="text-charcoal">
              {impact >= 0 ? "+" : ""}
              {impact.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-ash text-[11px]">Slippage</span>
        {SLIPPAGE_OPTIONS.map((bps) => (
          <button
            key={bps}
            type="button"
            aria-pressed={slippageBps === bps}
            onClick={() => setSlippageBps(bps)}
            className={
              slippageBps === bps
                ? "bg-dusk text-paper rounded px-2 py-0.5 text-[11px]"
                : "bg-linen text-charcoal rounded px-2 py-0.5 text-[11px]"
            }
          >
            {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
          </button>
        ))}
      </div>

      {blocked !== null ? (
        <Button className="w-full" disabled>
          {blocked}
        </Button>
      ) : !allowanceEnough ? (
        <Button className="w-full" disabled={busy} onClick={onApprove}>
          {busy ? "Approving…" : `Approve ${inSymbol}`}
        </Button>
      ) : (
        <Button className="w-full" disabled={busy} onClick={onSwap}>
          {busy ? "Swapping…" : `Swap ${inSymbol} for ${outSymbol}`}
        </Button>
      )}

      {tx.error !== null && (
        <p className="text-destructive text-[11px]">{describeRevert(tx.error)}</p>
      )}
      {outcome !== null && <p className="text-provenance-live text-[11px]">{outcome}</p>}
      <p className="text-ash text-[11px]">
        Approve the market manager, not the pool. A partial order stops early and refunds the unspent
        input. Buying {symbol} requires a verified wallet.
      </p>
    </section>
  );
}

function blockedReason(input: {
  isConnected: boolean;
  chainCorrect: boolean;
  expectedChain: number;
  verified: boolean | undefined;
  amountValid: boolean;
  balanceEnough: boolean;
  fixtureMode: boolean;
  quotePending: boolean;
  quoteUnavailable: boolean;
  hasQuote: boolean;
}): string | null {
  if (!input.isConnected) return "Connect wallet to trade";
  if (!input.chainCorrect) return `Switch to ${chainName(input.expectedChain)}`;
  if (input.verified !== true) return "Verify your wallet to trade";
  if (!input.amountValid) return "Enter an amount";
  if (!input.balanceEnough) return "Insufficient balance";
  if (input.fixtureMode) return "Live quotes need the backend — set VITE_API_URL";
  if (input.quoteUnavailable) return "No quote — this trade would fail or has no liquidity";
  if (input.quotePending) return "Quoting…";
  if (!input.hasQuote) return "No quote available";
  return null;
}

function computeImpact(
  amountOut: string | undefined,
  spent: string | undefined,
  spot: string | null,
): number | null {
  if (amountOut === undefined || spent === undefined || spot === null) return null;
  const spend = toPlotNumber(spent);
  const spotValue = toPlotNumber(spot);
  if (spend <= 0 || spotValue <= 0) return null;
  return ((toPlotNumber(amountOut) / spend) / spotValue - 1) * 100;
}

