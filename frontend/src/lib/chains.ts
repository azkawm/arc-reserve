import { defineChain } from "viem";

/**
 * Chain definitions for the wallet and for direct reads.
 *
 * Values match the backend's verified chain client: `backend/src/chain/client.ts` for the RPCs,
 * and `FRONTEND_INTEGRATION_PLAN.md` §A.2 for the native currencies. Two details are easy to get
 * wrong and are stated here once:
 *
 *  - Arc's gas token is **USDC with 18 decimals at the EVM level** — not the product's mUSD
 *    (6 decimals), and not the 6 decimals USDC uses on other chains.
 *  - Hedera's public RPC does not support JSON-RPC batching, and Arc's free dRPC tier caps a
 *    batch at 3, so the transports below configure batching rather than assuming it.
 */

export const HEDERA_CHAIN_ID = 296;
export const ARC_CHAIN_ID = 5042002;
export const ANVIL_CHAIN_ID = 31337;

export const anvil = defineChain({
  id: ANVIL_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
});

export const hedera = defineChain({
  id: HEDERA_CHAIN_ID,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet.hashio.io/api"] },
  },
  blockExplorers: {
    default: { name: "HashScan", url: "https://hashscan.io/testnet" },
  },
});

export const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://arc-testnet.drpc.org"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  // Arc publishes Multicall3 from block 1; Hedera does not, so it is left unset there.
  contracts: {
    multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11", blockCreated: 1 },
  },
});

/** The chain whose name a screen shows when the page and the wallet disagree. */
export function chainName(chainId: number): string {
  switch (chainId) {
    case HEDERA_CHAIN_ID:
      return hedera.name;
    case ARC_CHAIN_ID:
      return arc.name;
    case ANVIL_CHAIN_ID:
      return anvil.name;
    default:
      return `Chain ${chainId}`;
  }
}

/** A compact label for the chain switch on narrow screens. */
export function chainShortName(chainId: number): string {
  switch (chainId) {
    case HEDERA_CHAIN_ID:
      return "Hedera";
    case ARC_CHAIN_ID:
      return "Arc";
    case ANVIL_CHAIN_ID:
      return "Anvil";
    default:
      return `#${chainId}`;
  }
}

/**
 * A block-explorer link for a transaction, or `null` where the chain has no explorer (Anvil).
 * HashScan and Blockscout (ArcScan) use different paths for a transaction hash.
 */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  switch (chainId) {
    case HEDERA_CHAIN_ID:
      return `https://hashscan.io/testnet/transaction/${txHash}`;
    case ARC_CHAIN_ID:
      return `https://testnet.arcscan.app/tx/${txHash}`;
    default:
      return null;
  }
}
