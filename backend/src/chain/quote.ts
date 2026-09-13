import {
  BaseError,
  ContractFunctionRevertedError,
  getAddress,
  type Address,
} from 'viem';
import { loadAbi } from './abis.js';
import type { ArcPublicClient } from './client.js';

/**
 * Quote a `swapExactInput` trade WITHOUT sending a transaction and without a private key on this
 * process. `eth_call` needs a `from` address for the manager's `safeTransferFrom(msg.sender, ...)`
 * to not revert on an unfunded caller, and for the pool to have somewhere permissioned to pay the
 * output token, but it needs no signature -- the output depends only on pool state, not on who
 * asks. `QUOTE_WALLET_ADDRESS` is a wallet provisioned once, out of band (self-registered,
 * approved to the manager, holding a working balance of both tokens); this module only ever reads
 * its address, never a key.
 *
 * ONE THING `eth_call` CANNOT GIVE US: `swapExactInput`'s Solidity signature is
 * `returns (uint256 amountOut)` — `spent`, the amount actually taken on a partial fill, exists
 * only as a local variable and in the `SwapExactInput` event (D-037). A plain `eth_call` reads
 * only a function's return data, never its emitted logs, on any standard EVM node — so `spent`
 * is not recoverable by decoding this call differently; the return type genuinely does not carry
 * it. Found 2026-09-13 (Contract Arch, forking both chains and reading the real balance delta of
 * a 50,000 mUSD quote: spent 794.599476, not 50,000 — identical on Hedera and Arc) after this
 * endpoint shipped reporting only `amountOut`, which is exactly the "amountOut ÷ amountIn instead
 * of amountOut ÷ spent" trap the wallet-writes section already named for the real trade.
 *
 * FIX, without a contract redeploy or a non-standard RPC feature (`debug_traceCall`-style log
 * decoding is real on some nodes but unverified on Hashio and dRPC, and this session has been
 * burned twice tonight by assuming an RPC feature without measuring it): saturation is an EXACT,
 * not heuristic, property of `_routeSwap`'s price-limit swap. Once the trade's price limit is
 * reached, `amountOut` stops increasing no matter how much more input is offered — so calling the
 * SAME quote at `amountIn` and at a larger `amountIn` and finding an IDENTICAL `amountOut` proves
 * `spent < amountIn` with certainty, not a guess. When that fires, a bounded binary search over
 * `[0, amountIn]` converges on `spent` to fine precision using only more calls to the same
 * unmodified `swapExactInput` -- no new contract surface, no tick math reimplemented here.
 * The common case (no saturation) costs exactly one extra call and returns `spent === amountIn`.
 */
export interface SwapQuote {
  amountOut: bigint;
  /** What the trade would actually consume. Equal to the requested amount unless `partialFill`. */
  spent: bigint;
  /** True when the requested amount exceeds what the pool can currently absorb in this direction. */
  partialFill: boolean;
}

export class QuoteRevertedError extends Error {
  readonly errorName: string;

  constructor(errorName: string, message: string) {
    super(message);
    this.name = 'QuoteRevertedError';
    this.errorName = errorName;
  }
}

/** Same wording a UI would want to show for the real trade, not a raw Solidity error name. */
const REVERT_MESSAGES: Record<string, string> = {
  InvalidSwapDirection: 'this pool cannot fill any part of that trade right now',
  InvalidPoolTokens: 'tokenIn is neither of this asset’s two pool tokens',
  SlippageExceeded: 'the trade would return less than the minimum requested',
  DeadlineExpired: 'the quote deadline has already passed',
  EnforcedPause: 'this market is currently paused',
  AccessControlUnauthorizedAccount:
    'the quote wallet is not authorised to trade -- it may need re-registering on this chain',
};

// Bounds the binary search's cost: at most this many extra `eth_call`s, only on the (expected
// rare) saturated path — a healthy quote never pays this. 24 halvings resolve better than
// 1-in-16-million of the search range, ample for a UI preview of a value the real transaction
// computes exactly on its own; this endpoint is a preview, never the settlement.
const MAX_SEARCH_ITERATIONS = 24;

export async function quoteSwapExactInput(
  client: ArcPublicClient,
  marketManager: string,
  quoteWallet: `0x${string}`,
  tokenIn: string,
  amountIn: bigint,
): Promise<SwapQuote> {
  const abi = loadAbi('AssetMarketManager');
  const manager = getAddress(marketManager);
  const token = getAddress(tokenIn);

  const call = async (amount: bigint): Promise<bigint> => {
    try {
      return (await client.readContract({
        address: manager,
        abi,
        functionName: 'swapExactInput',
        args: [token, amount, 0n, MAX_DEADLINE],
        account: quoteWallet,
      })) as bigint;
    } catch (error) {
      throw toQuoteError(error);
    }
  };

  const amountOut = await call(amountIn);

  // Saturation check: an amount twice the request produces the SAME output only if the pool's
  // price limit was already reached at the requested size — a real trade there refunds the rest.
  const probe = await call(amountIn * 2n);
  if (probe !== amountOut) {
    return { amountOut, spent: amountIn, partialFill: false };
  }

  const spent = await findSpent(call, amountIn, amountOut);
  return { amountOut, spent, partialFill: true };
}

/**
 * `amountIn` is known saturated (produces `saturatedOut`); 0 is known not to be (a zero-input
 * swap reverts before this is called, so nothing below the true threshold saturates). Binary
 * search the boundary: the largest `mid` whose own quote still equals `saturatedOut` is not
 * necessarily `spent` itself (several inputs at the tail can share the last output rounding
 * step), but converges to within the search's resolution — see `MAX_SEARCH_ITERATIONS`.
 */
async function findSpent(
  call: (amount: bigint) => Promise<bigint>,
  amountIn: bigint,
  saturatedOut: bigint,
): Promise<bigint> {
  let lo = 0n;
  let hi = amountIn;
  for (let i = 0; i < MAX_SEARCH_ITERATIONS && hi - lo > 1n; i += 1) {
    const mid = lo + (hi - lo) / 2n;
    const out = await call(mid);
    if (out === saturatedOut) hi = mid;
    else lo = mid;
  }
  return hi;
}

// Far enough out that no realistic quote request would ever be evaluated after it; a quote never
// broadcasts, so there is no mempool delay for this to guard against, unlike a real trade's
// deadline (see docs-handover/PRODUCT_KNOWLEDGE.md's wallet-writes section for that one).
const MAX_DEADLINE = 9_999_999_999n;

function toQuoteError(error: unknown): QuoteRevertedError | Error {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? 'unknown';
      return new QuoteRevertedError(
        name,
        REVERT_MESSAGES[name] ?? `the manager refused this trade (${name})`,
      );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

export type { Address };
