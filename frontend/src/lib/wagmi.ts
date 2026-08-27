import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

export const anvil = defineChain({
  id: 31_337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
});

export const wagmiConfig = createConfig({
  chains: [anvil],
  connectors: [injected()],
  transports: { [anvil.id]: http(anvil.rpcUrls.default.http[0]) },
  ssr: true,
});

