"use client";

import { parseAbi } from "viem";
import { useWriteContract } from "wagmi";
import { addresses, contractsConfigured } from "@/lib/contracts";

const engineAbi = parseAbi(["function rebalanceToNAV(int24,int24)", "function slide(int24,int24)", "function sweep(int24,int24)"]);

export function EngineControls() {
  const { writeContract, isPending, error, data } = useWriteContract();
  const call = (operation: "rebalanceToNAV" | "slide" | "sweep") => {
    if (!contractsConfigured) return;
    writeContract({ address: addresses.market, abi: engineAbi, functionName: operation, args: [-276540, -275940] });
  };
  return (
    <div className="engine-controls">
      <button className="primary-button" onClick={() => call("rebalanceToNAV")} disabled={isPending || !contractsConfigured}>Rebalance to NAV</button>
      <button className="secondary-button" onClick={() => call("slide")} disabled={isPending || !contractsConfigured}>Safe slide</button>
      <button className="secondary-button" onClick={() => call("sweep")} disabled={isPending || !contractsConfigured}>Safe sweep</button>
      {!contractsConfigured && <span>Connect deployment addresses to enable keeper actions.</span>}
      {error && <span className="negative">{error.message.slice(0, 100)}</span>}
      {data && <span className="positive">Submitted {data.slice(0, 10)}…</span>}
    </div>
  );
}
