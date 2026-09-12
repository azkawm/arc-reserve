import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const anvil = defineChain({
  id: 31_337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
});

/**
 * `ssr` is deliberately absent. The Next.js build set `ssr: true` because wagmi had to survive
 * a server render pass; this is a client-rendered SPA, so hydration-safe storage is not needed
 * and claiming it would be misleading about how the app runs.
 */
export const wagmiConfig = createConfig({
  chains: [anvil],
  connectors: [injected()],
  transports: { [anvil.id]: http(anvil.rpcUrls.default.http[0]) },
});
