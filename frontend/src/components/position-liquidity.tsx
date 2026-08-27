import { liquidityPositions } from "@/lib/data";

export function PositionLiquidity({ embedded = false }: { embedded?: boolean }) {
  return (
    <section className={`${embedded ? "embedded " : "panel "}position-liquidity`}>
      <div className="position-liquidity-head">
        <div><span className="eyebrow">MARKET INVENTORY</span><h2>Liquidity by position</h2></div>
        <span>Mock live balances</span>
      </div>
      <div className="position-liquidity-grid">
        {liquidityPositions.map((position) => (
          <div className={`liquidity-position ${position.id}`} key={position.id}>
            <div className="liquidity-position-top">
              <span><i /> {position.label}</span>
              <b>{position.status}</b>
            </div>
            <strong>{position.primary}</strong>
            <small>{position.secondary}</small>
            <em>{position.range}</em>
          </div>
        ))}
      </div>
      <p>These balances belong to market-making positions. The 24,600 mUSD protected reserve remains separate and cannot be deployed here.</p>
    </section>
  );
}
