import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Turn a contract revert into the rule's name and a plain-language meaning.
 *
 * "Transaction failed" tells a judge nothing and reads like a bug. The protocol reverts with named
 * custom errors on purpose (PRODUCT_KNOWLEDGE §6), so the name is the message. Unknown reverts fall
 * back to viem's own message rather than being hidden.
 */
const EXPLANATION: Record<string, string> = {
  RecipientNotVerified: "That wallet is not KYC-verified, and the token is permissioned.",
  SenderNotVerified: "Your wallet is not KYC-verified yet.",
  ClassWalletLimitExceeded: "This would exceed your investor class's per-wallet cap.",
  ClassAggregateCapExceeded: "This would exceed your investor class's aggregate cap.",
  WalletLimitExceeded: "This exceeds the per-wallet purchase limit.",
  FundraisingCapExceeded: "The offering has reached its hard cap.",
  InventoryExceeded: "Not enough token inventory remains.",
  PurchaseTooSmall: "The purchase is below the minimum ticket.",
  OfferingNotOpen: "The offering is not open right now.",
  AssetNotActive: "The asset is not active.",
  ZeroTokenOutput: "The trade would output zero tokens.",
  PeriodLimitExceeded: "This exceeds the per-day redemption limit.",
  InsufficientReserveLiquidity: "The reserve cannot cover this redemption right now.",
  IssuerAllocationCannotRedeem: "Issuer allocations cannot be redeemed.",
  MaturityWindowClosed: "The maturity redemption window is closed.",
  InvalidMode: "That redemption mode is not valid.",
  NoRevenueToClaim: "There is nothing to claim yet.",
  SlippageExceeded: "The price moved past your slippage tolerance.",
  DeadlineExpired: "The transaction deadline passed before it confirmed.",
  InvalidSwapDirection: "No liquidity on that side of the pool right now.",
  InvalidPoolTokens: "Those tokens are not the pool's pair.",
  CooldownActive: "The floor ratchet is in cooldown; try again after it elapses.",
  FloorCeilingExceeded: "The floor cannot rise past min(NAV, backing).",
  UnsupportedChain: "This chain is not supported by the demo registrar.",
  ReserveShortfallActive: "Issuer withdrawals are blocked during an enforced shortfall.",
  SystemNotActive: "The asset system is not active yet (deployment still in progress).",
  UnauthorizedIssuer: "This wallet is not the asset's issuer.",
  TermsMismatch: "The deployment parameters no longer match the approved terms hash.",
  NAVMovementTooLarge: "A NAV update cannot move more than 20% from the last value.",
  AccessControlUnauthorizedAccount: "This wallet does not hold the required role.",
  ERC20InsufficientAllowance: "Approve the contract first, then retry.",
  ERC20InsufficientBalance: "Insufficient token balance.",
};

export function describeRevert(error: unknown): string {
  const name = revertName(error);
  if (name !== null) {
    return EXPLANATION[name] ?? name;
  }
  if (error instanceof Error) return error.message;
  return "Transaction reverted.";
}

/** The custom error's name, if viem decoded one; otherwise its reason string. */
export function revertName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName ?? revert.reason ?? null;
  }
  return null;
}
