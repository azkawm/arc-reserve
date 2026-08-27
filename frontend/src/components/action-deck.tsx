"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { addresses, contractsConfigured, erc20Abi, offeringAbi, redemptionAbi, revenueAbi } from "@/lib/contracts";

type Tab = "Buy" | "Sell" | "Claim" | "Redeem";
const tabs: Tab[] = ["Buy", "Sell", "Claim", "Redeem"];

export function ActionDeck() {
  const [tab, setTab] = useState<Tab>("Buy");
  const [amount, setAmount] = useState("1000");
  const [message, setMessage] = useState("");
  const { address, isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract({
    mutation: { onSuccess: (hash) => setMessage(`Submitted ${hash.slice(0, 10)}…`), onError: (error) => setMessage(error.message) },
  });
  const { data: claimable } = useReadContract({
    address: addresses.revenue,
    abi: revenueAbi,
    functionName: "claimableRevenue",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: contractsConfigured && Boolean(address) },
  });

  const preview = useMemo(() => Number(amount || 0), [amount]);
  const canWrite = isConnected && contractsConfigured;

  const submit = () => {
    setMessage("");
    if (!canWrite) {
      setMessage("Connect to the seeded Anvil deployment to submit this transaction.");
      return;
    }
    if (tab === "Buy") {
      writeContract({ address: addresses.offering, abi: offeringAbi, functionName: "buy", args: [parseUnits(amount || "0", 6), 0n] });
    } else if (tab === "Claim") {
      writeContract({ address: addresses.revenue, abi: revenueAbi, functionName: "claimRevenue" });
    } else if (tab === "Redeem") {
      writeContract({ address: addresses.redemption, abi: redemptionAbi, functionName: "redeem", args: [parseUnits(amount || "0", 18), 0n, 0] });
    } else {
      setMessage("A production router adapter is intentionally not included in this MVP.");
    }
  };

  const approve = () => {
    if (!canWrite) return setMessage("Connect to the seeded Anvil deployment first.");
    writeContract({ address: addresses.musd, abi: erc20Abi, functionName: "approve", args: [addresses.offering, parseUnits(amount || "0", 6)] });
  };

  return (
    <section className="action-deck panel">
      <div className="trade-card-heading">
        <div><span className="eyebrow">ASSET MARKET</span><h2>SOLAR01</h2></div>
        <div><span>Current MVP</span><strong>1.018 mUSD</strong></div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); setMessage(""); }} type="button">{item}</button>)}
      </div>
      {tab === "Claim" ? (
        <div className="claim-balance"><span>Claimable circulating-token yield</span><strong>{claimable ? formatUnits(claimable, 6) : "142.80"} mUSD</strong><p>Calculated across 38,400 yield-eligible circulating tokens. Company vesting is excluded until release.</p></div>
      ) : (
        <label className="amount-field">
          <span>{tab === "Buy" ? "You pay" : "Token amount"}<small>Balance: {tab === "Buy" ? "25,000 mUSD" : "12,500 SOLAR01"}</small></span>
          <div><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label={`${tab} amount`} /><b>{tab === "Buy" ? "mUSD" : "SOLAR01"}</b><button type="button" onClick={() => setAmount(tab === "Buy" ? "25000" : "12500")}>MAX</button></div>
        </label>
      )}
      <div className="trade-summary">
        {tab === "Buy" && <><span>You receive</span><strong>{(preview / 1.018).toLocaleString(undefined, { maximumFractionDigits: 2 })} SOLAR01</strong></>}
        {tab === "Sell" && <><span>Indicative output</span><strong>{(preview * 1.018).toLocaleString()} mUSD</strong></>}
        {tab === "Redeem" && <><span>Reserve-limited estimate</span><strong>{(preview * 0.82).toLocaleString()} mUSD</strong></>}
        {tab === "Claim" && <><span>Circulating-holder allocation</span><strong>60% of settled revenue</strong></>}
      </div>
      {(tab === "Buy" || tab === "Sell") && <div className="trade-details"><span>Rate <strong>1 SOLAR01 = 1.018 mUSD</strong></span><span>Protected floor reference <strong>0.820 mUSD</strong></span><span>Price impact <strong className="positive">&lt;0.1%</strong></span></div>}
      {tab === "Redeem" && <div className="floor-guard"><span>Reserve-limited action</span><strong>Available liquidity: 24,600 mUSD</strong></div>}
      {tab === "Buy" && <button className="secondary-button full" onClick={approve} type="button">Approve mUSD</button>}
      <button className="primary-button full trade-submit" onClick={submit} disabled={isPending} type="button">{isPending ? "Confirming…" : tab === "Sell" ? "Preview sell" : tab === "Buy" ? "Buy SOLAR01" : tab}</button>
      {message && <p className="form-message" role="status">{message}</p>}
      <p className="legal-note">Current MVP buys use the direct offering contract. Target escrow, staged issuance, and token locking are not yet enforced. Market price can move and redemption is limited by available reserve liquidity.</p>
    </section>
  );
}
