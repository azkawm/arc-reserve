import { parseAbi } from "viem";
import { deploymentFor, type ChainDeployment } from "@/lib/deployments";

/**
 * Contract ABIs and per-chain address resolution.
 *
 * Addresses are no longer read from `VITE_*_ADDRESS` variables: a single env set cannot express
 * two chains, and `deployments.ts` keys every address by `(chainId, address)` (INTEGRATION_GUIDE
 * §2.3). This module only carries the ABIs the frontend actually calls; it is not a generated
 * ABI layer.
 */

export { deploymentFor as addressesFor } from "@/lib/deployments";
export type { ChainDeployment };

/** The deployment's `bytes32` assetId for a chain — the canonical key, not the slug. */
export function assetIdFor(chainId: number): `0x${string}` {
  return deploymentFor(chainId).assetId;
}

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
  "event FaucetUsed(address indexed account,uint256 amount)",
]);

/** mUSD is 6 decimals on every chain; SOLAR01 is 18. Never mix them. */
export const MUSD_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

/**
 * The user trade path is the manager (D-037), never the pool or a router. Approve the manager,
 * and display `amountSpent` — on a partial fill the event's `amountRequested > amountSpent` and
 * the remainder is refunded.
 */
export const marketManagerAbi = parseAbi([
  "function swapExactInput(address tokenIn,uint256 amountIn,uint256 minAmountOut,uint256 deadline) returns (uint256)",
  "event SwapExactInput(address indexed trader,address indexed tokenIn,uint256 amountRequested,uint256 amountSpent,uint256 amountOut)",
]);

export const offeringAbi = parseAbi([
  "function buy(uint256 stablecoinAmount,uint256 minimumTokensOut) returns (uint256)",
  "function stablecoinRaised() view returns (uint256)",
  "function availableTokenInventory() view returns (uint256)",
  "event TokensPurchased(address indexed buyer,uint256 stablecoinAmount,uint256 tokenAmount,uint256 issuerShare,uint256 reserveShare,uint256 marketShare)",
]);

export const vaultAbi = parseAbi([
  "function depositInitialReserve(uint256)",
  "function redemptionReserve() view returns (uint256)",
  "function reserveRatioBps() view returns (uint256)",
  "function isSolvent() view returns (bool)",
]);

/**
 * `depositRevenue` takes **three** arguments since 2026-08-30 (amount, periodId, reportHash). The
 * one-argument form this module previously declared used a different selector and reverted on
 * every call (plan §W, action 13).
 */
export const revenueAbi = parseAbi([
  "function depositRevenue(uint256 amount,uint256 periodId,bytes32 reportHash)",
  "function claimRevenue() returns (uint256)",
  "function claimableRevenue(address) view returns (uint256)",
  "function circulatingSupply() view returns (uint256)",
  "function yieldEligibleBalanceOf(address) view returns (uint256)",
  "function yieldExcluded(address) view returns (bool)",
]);

export const redemptionAbi = parseAbi([
  "function redeem(uint256 tokenAmount,uint256 minimumStablecoinOut,uint8 mode) returns (uint256)",
  "function redemptionPrice(uint8 mode) view returns (uint256)",
]);

export const registryAbi = parseAbi([
  "function submitAsset(string,string,string,bytes32,uint64) returns (bytes32)",
  "function approveAsset(bytes32 assetId,uint256 initialNAV,bytes32 termsHash)",
  "function publishNAV(bytes32,uint256)",
  "function suspendAsset(bytes32)",
  "function markDefault(bytes32)",
  "function markMatured(bytes32)",
  "function navOf(bytes32) view returns (uint256,uint64)",
]);

/** Identity: the token is permissioned, so a fresh wallet must self-register before it can buy. */
export const identityAbi = parseAbi([
  "function isVerified(address) view returns (bool)",
  "function transferRestriction(address from,address to,uint256 value) view returns (uint256)",
]);

export const demoRegistrarAbi = parseAbi([
  "function isActive() view returns (bool)",
  "function canSelfRegister(address) view returns (bool)",
  "function selfRegister()",
]);
