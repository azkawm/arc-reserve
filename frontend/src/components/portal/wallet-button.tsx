import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/format";

/**
 * Minimal wallet control for the portal shell. Connecting is not a write; it just makes the
 * wallet address available to the account route and to the chain guard. The injected connector
 * is the only one configured for the demo.
 */
export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address !== undefined) {
    return (
      <Button variant="outline" size="sm" onClick={() => disconnect()}>
        {shortAddress(address)}
      </Button>
    );
  }

  const injected = connectors[0];
  return (
    <Button
      size="sm"
      disabled={injected === undefined || isPending}
      onClick={() => {
        if (injected !== undefined) connect({ connector: injected });
      }}
    >
      Connect wallet
    </Button>
  );
}
