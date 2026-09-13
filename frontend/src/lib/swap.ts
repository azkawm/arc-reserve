import { formatUnits } from "viem";
import { formatAmount } from "@/lib/format";

/**
 * The one place a swap's raw amounts become a sentence.
 *
 * `SwapExactInput` carries `amountRequested`, `amountSpent` and `amountOut` in base units; on a
 * partial fill `amountRequested > amountSpent` and the remainder is refunded (D-037). The refund
 * must be shown only when it is real, so this returns it as `null` rather than `"0"`.
 */
export interface SwapSummaryInput {
  amountRequested: bigint;
  amountSpent: bigint;
  amountOut: bigint;
  inDecimals: number;
  outDecimals: number;
  inSymbol: string;
  outSymbol: string;
}

export interface SwapSummary {
  text: string;
  refunded: boolean;
  refundText: string | null;
}

export function formatSwapSummary(input: SwapSummaryInput): SwapSummary {
  const spent = formatAmount(formatUnits(input.amountSpent, input.inDecimals));
  const received = formatAmount(formatUnits(input.amountOut, input.outDecimals));
  const refunded = input.amountRequested > input.amountSpent;
  const refund = refunded
    ? formatAmount(formatUnits(input.amountRequested - input.amountSpent, input.inDecimals))
    : null;

  return {
    text: `Spent ${spent} ${input.inSymbol}, received ${received} ${input.outSymbol}`,
    refunded,
    refundText: refund === null ? null : `refunded ${refund} ${input.inSymbol}`,
  };
}
