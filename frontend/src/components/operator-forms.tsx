"use client";

import { useState } from "react";
import { keccak256, parseUnits, toHex } from "viem";
import { useWriteContract } from "wagmi";
import { assetId, addresses, contractsConfigured, erc20Abi, registryAbi, revenueAbi, vaultAbi } from "@/lib/contracts";

function useTransactionMessage() {
  const [message, setMessage] = useState("");
  const state = useWriteContract({ mutation: { onSuccess: (hash) => setMessage(`Submitted ${hash.slice(0, 12)}…`), onError: (error) => setMessage(error.message) } });
  return { ...state, message, setMessage };
}

export function IssuerForms() {
  const [reserve, setReserve] = useState("20000");
  const [revenueAmount, setRevenueAmount] = useState("1000");
  const { writeContract, message, setMessage, isPending } = useTransactionMessage();
  const guard = () => { if (!contractsConfigured) { setMessage("Add local deployment addresses to .env.local first."); return false; } return true; };

  return (
    <div className="operator-grid">
      <form className="panel form-panel" onSubmit={(event) => { event.preventDefault(); if (!guard()) return; writeContract({ address: addresses.registry, abi: registryAbi, functionName: "submitAsset", args: ["Solar Indonesia 02", "Renewable energy", "ipfs://metadata-uri", keccak256(toHex("solar-indonesia-02")), BigInt(Math.floor(Date.now() / 1000) + 3 * 365 * 86400)] }); }}>
        <span className="step-number">01</span><h2>Register an asset</h2><p>Anchor identifying metadata before verification.</p>
        <label>Asset name<input defaultValue="Solar Indonesia 02" /></label>
        <label>Category<input defaultValue="Renewable energy" /></label>
        <label>Metadata URI<input defaultValue="ipfs://metadata-uri" /></label>
        <button className="primary-button full" disabled={isPending}>Submit for review</button>
      </form>
      <form className="panel form-panel" onSubmit={(event) => { event.preventDefault(); if (!guard()) return; writeContract({ address: addresses.vault, abi: vaultAbi, functionName: "depositInitialReserve", args: [parseUnits(reserve, 6)] }); }}>
        <span className="step-number">02</span><h2>Seed reserve</h2><p>Approve mUSD, then move issuer-funded liquidity into the protected category.</p>
        <label>Reserve amount<div className="input-unit"><input value={reserve} onChange={(e) => setReserve(e.target.value)} /><b>mUSD</b></div></label>
        <button type="button" className="secondary-button full" onClick={() => { if (!guard()) return; writeContract({ address: addresses.musd, abi: erc20Abi, functionName: "approve", args: [addresses.vault, parseUnits(reserve, 6)] }); }}>Approve mUSD</button>
        <button className="primary-button full" disabled={isPending}>Deposit reserve</button>
      </form>
      <form className="panel form-panel" onSubmit={(event) => { event.preventDefault(); if (!guard()) return; writeContract({ address: addresses.revenue, abi: revenueAbi, functionName: "depositRevenue", args: [parseUnits(revenueAmount, 6)] }); }}>
        <span className="step-number">03</span><h2>Deposit revenue</h2><p>Simulate settled electricity-sale proceeds and apply the 60/25/10/5 split.</p>
        <label>Revenue amount<div className="input-unit"><input value={revenueAmount} onChange={(e) => setRevenueAmount(e.target.value)} /><b>mUSD</b></div></label>
        <button type="button" className="secondary-button full" onClick={() => { if (!guard()) return; writeContract({ address: addresses.musd, abi: erc20Abi, functionName: "approve", args: [addresses.revenue, parseUnits(revenueAmount, 6)] }); }}>Approve mUSD</button>
        <button className="primary-button full" disabled={isPending}>Deposit revenue</button>
      </form>
      {message && <p className="form-message operator-message">{message}</p>}
    </div>
  );
}

export function VerifierActions() {
  const [nav, setNav] = useState("1.05");
  const { writeContract, message, setMessage, isPending } = useTransactionMessage();
  const submit = (functionName: "publishNAV" | "suspendAsset" | "markDefault" | "markMatured") => {
    if (!contractsConfigured) return setMessage("Add local deployment addresses to .env.local first.");
    if (functionName === "publishNAV") writeContract({ address: addresses.registry, abi: registryAbi, functionName, args: [assetId, parseUnits(nav, 6)] });
    else writeContract({ address: addresses.registry, abi: registryAbi, functionName, args: [assetId] });
  };
  return (
    <section className="panel verifier-actions">
      <div className="panel-heading"><div><span className="eyebrow">VERIFIER CONTROLS</span><h2>Solar Indonesia 01</h2></div><span className="small-badge">Active</span></div>
      <div className="review-grid">
        <div><span>Metadata hash</span><strong>0x7e42…98ac</strong></div><div><span>Current NAV</span><strong>1.000 mUSD</strong></div><div><span>Last update</span><strong>42 minutes ago</strong></div><div><span>Movement limit</span><strong>20.0%</strong></div>
      </div>
      <div className="nav-publisher"><label>New verified NAV<div className="input-unit"><input value={nav} onChange={(e) => setNav(e.target.value)} /><b>mUSD</b></div></label><button className="primary-button" onClick={() => submit("publishNAV")} disabled={isPending}>Publish NAV</button></div>
      <div className="danger-actions"><button onClick={() => submit("suspendAsset")}>Suspend</button><button onClick={() => submit("markMatured")}>Mark matured</button><button className="danger" onClick={() => submit("markDefault")}>Mark default</button></div>
      {message && <p className="form-message">{message}</p>}
    </section>
  );
}
