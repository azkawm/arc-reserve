import { parseAbi, type Address } from "viem";

const zero = "0x0000000000000000000000000000000000000000" as Address;
const address = (value?: string) => (value?.startsWith("0x") ? (value as Address) : zero);

export const addresses = {
  musd: address(import.meta.env.VITE_MUSD_ADDRESS),
  registry: address(import.meta.env.VITE_REGISTRY_ADDRESS),
  token: address(import.meta.env.VITE_TOKEN_ADDRESS),
  vault: address(import.meta.env.VITE_VAULT_ADDRESS),
  offering: address(import.meta.env.VITE_OFFERING_ADDRESS),
  market: address(import.meta.env.VITE_MARKET_MANAGER_ADDRESS),
  revenue: address(import.meta.env.VITE_REVENUE_DISTRIBUTOR_ADDRESS),
  redemption: address(import.meta.env.VITE_REDEMPTION_CONTROLLER_ADDRESS),
};

export const assetId = (import.meta.env.VITE_ASSET_ID ?? `0x${"0".repeat(64)}`) as `0x${string}`;
export const contractsConfigured = Object.values(addresses).every((item) => item !== zero);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
]);

export const offeringAbi = parseAbi([
  "function buy(uint256 stablecoinAmount,uint256 minimumTokensOut) returns (uint256)",
  "function stablecoinRaised() view returns (uint256)",
  "function availableTokenInventory() view returns (uint256)",
]);

export const vaultAbi = parseAbi([
  "function depositInitialReserve(uint256)",
  "function redemptionReserve() view returns (uint256)",
  "function reserveRatioBps() view returns (uint256)",
  "function isSolvent() view returns (bool)",
]);

export const revenueAbi = parseAbi([
  "function depositRevenue(uint256)",
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
  "function publishNAV(bytes32,uint256)",
  "function suspendAsset(bytes32)",
  "function markDefault(bytes32)",
  "function markMatured(bytes32)",
  "function navOf(bytes32) view returns (uint256,uint64)",
]);
