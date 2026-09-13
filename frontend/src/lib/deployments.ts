import type { Address } from "viem";

/**
 * Per-chain contract addresses, keyed by `chainId`.
 *
 * The same deployer nonce placed **different contracts at the same address** on the two live
 * chains (`0xECEbb2dA…` is `AssetRegistry` on Hedera and `AssetFactory` on Arc), so an address
 * is never meaningful without its chain (INTEGRATION_GUIDE §2.3). These values are transcribed
 * from `contracts/deployments/<chainId>.json`; when a layout changes, re-copy rather than guess.
 *
 * This file is the frontend's single source of contract locations. Nothing reads a
 * `VITE_*_ADDRESS` variable any more — one env var set cannot express two chains.
 */

export interface ChainDeployment {
  chainId: number;
  name: string;
  assetId: `0x${string}`;
  mockUSD: Address;
  token: Address;
  vault: Address;
  offering: Address;
  marketManager: Address;
  revenueDistributor: Address;
  redemptionController: Address;
  registry: Address;
  demoRegistrar: Address;
  identityRegistry: Address;
  pool: Address;
  floorController: Address;
  poolIsCanonical: boolean;
}

export const DEPLOYMENTS: Record<number, ChainDeployment> = {
  296: {
    chainId: 296,
    name: "Hedera Testnet",
    assetId: "0xda699bc78ef95f03df4596582f7a3a29f8b95d5984d8b8fa279df0747959f4c4",
    mockUSD: "0x48D8dad3cF46F99CEc63466cD9AF8F8f56aa301C",
    token: "0x2a92796fA4eB95C1F5B55EbeD403bB42e9026827",
    vault: "0x1F5238616aabdCD588dBE07f6d938a998C9428c8",
    offering: "0x753B1e50Fd3Db319DC4Aa03a7602478ef6392dD4",
    marketManager: "0xaA6C6A4CE2d5cA6e58e537dE3823828cb86478c2",
    revenueDistributor: "0xC4C11E4593C86B9Ab10bcB5ffaD279944E18ea8A",
    redemptionController: "0xe8A6A3e1995CA92C3c9427499F4Ee9134B5071C0",
    registry: "0xECEbb2dA14751dd4EBD481CA8493ed6d6A6EA78C",
    demoRegistrar: "0x2243aA04e2Ca2d90fdd94F1A8A7028E00B6fB68c",
    identityRegistry: "0xbAF79049B519e91673F82Fa30492059E8E7eBFF2",
    pool: "0xcb77d1068A3Cc3E846Fdaff14B80476f773c6d31",
    floorController: "0x34c1Ac45EfB6Edc68d9Afc248797D3B5b21dBBa4",
    poolIsCanonical: true,
  },
  5042002: {
    chainId: 5042002,
    name: "Arc Testnet",
    assetId: "0xa506084b6a93969fa19a9333646d2a2beed7ef5595869429e26c3540f76aa950",
    mockUSD: "0x7dfe931c0F5cFE65f61a5579193bffe010ebCe46",
    token: "0x18c2da6eC42B7E4d03fa6420C37a7e02176fF795",
    vault: "0x6FE42Da36C21b3854a9e802Cf9710581225F9ffA",
    offering: "0x5FE02E7a134572D35E8DB1CEA24A1BD4F810FF6A",
    marketManager: "0xbd50E96EDEA78CfD9dDC31C61aD2Ef902178F7c7",
    revenueDistributor: "0xEA9909fa772115A55cA36FB540Ff3147305f31af",
    redemptionController: "0xCc1AB4Ba8f7bAae0FDF2A5124Cfa790c44C88a43",
    registry: "0xdb04496167265b21783D1DF0C9A97C48711fe89C",
    demoRegistrar: "0xF6f77D0bE395df3d04B6E58a4a8fb0c34EC5286d",
    identityRegistry: "0x765b3b07ca2a305b72531605395fe0411aE6a476",
    pool: "0xA325eA08FD2CAC98c39fE3551B095fe89e913A28",
    floorController: "0xDBC17939A7C7368678e5627f9D3D183e8a0319E8",
    poolIsCanonical: true,
  },
};

/** The chains the product offers. Anvil (31337) is local dev and never product surface. */
export const PRODUCT_CHAIN_IDS = [296, 5042002] as const;
export type ProductChainId = (typeof PRODUCT_CHAIN_IDS)[number];

export function isProductChainId(chainId: number): chainId is ProductChainId {
  return (PRODUCT_CHAIN_IDS as readonly number[]).includes(chainId);
}

/** Resolve a chain's deployment, or throw — a missing deployment is a bug, not a fallback. */
export function deploymentFor(chainId: number): ChainDeployment {
  const deployment = DEPLOYMENTS[chainId];
  if (deployment === undefined) {
    throw new Error(`no deployment recorded for chainId ${chainId}`);
  }
  return deployment;
}
