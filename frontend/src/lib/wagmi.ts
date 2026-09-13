import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { anvil, arc, hedera } from "@/lib/chains";

/**
 * Wallet configuration.
 *
 * Both live product chains plus Anvil for local development. The `chains` order does **not**
 * decide which chain the portal shows — that is the chain context (`lib/chain-context.tsx`),
 * which defaults to Hedera. It only decides wagmi's fallback when no wallet is connected.
 *
 * `ssr` is deliberately absent: this is a client-rendered SPA, so hydration-safe storage is not
 * needed and claiming it would misdescribe how the app runs.
 *
 * Transports mirror the backend's constraints: Hedera's public RPC rejects JSON-RPC batching,
 * and Arc's free dRPC tier caps a batch at 3 — so both are configured without batching rather
 * than risking an oversized request.
 */
export const wagmiConfig = createConfig({
  chains: [anvil, hedera, arc],
  connectors: [injected()],
  transports: {
    [anvil.id]: http(anvil.rpcUrls.default.http[0]),
    [hedera.id]: http(hedera.rpcUrls.default.http[0], { batch: false }),
    [arc.id]: http(arc.rpcUrls.default.http[0], { batch: false, retryCount: 2 }),
  },
});
