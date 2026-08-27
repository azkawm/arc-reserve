"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Wallet } from "lucide-react";

const shorten = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button className="wallet-button connected" onClick={() => disconnect()} type="button">
        <span className="status-dot" /> {shorten(address)}
      </button>
    );
  }

  return (
    <button
      className="wallet-button"
      onClick={() => connectors[0] && connect({ connector: connectors[0] })}
      disabled={isPending || connectors.length === 0}
      type="button"
    >
      <Wallet size={15} /> {isPending ? "Connecting" : "Connect wallet"}
    </button>
  );
}

