import { ExternalLink } from "lucide-react";
import { DataPanel } from "@/components/data-source";
import { toSwapRows } from "@/lib/activity";
import { useChain } from "@/lib/chain-context";
import { explorerTxUrl } from "@/lib/chains";
import { addressesFor } from "@/lib/contracts";
import { formatAmount, formatRelative, shortAddress } from "@/lib/format";
import { useActivity } from "@/lib/queries";

/**
 * The wallet's swap and primary-buy history for this asset, from `/activity`.
 *
 * Each row shows the side (buy/sell), the amount spent, what was received, and the transaction
 * hash as a link to the chain's block explorer. On a chain with no explorer (Anvil) the hash is
 * shown as plain text rather than a dead link.
 */
export function TxHistoryPanel({ assetId, symbol }: { assetId: string; symbol: string }) {
  const { chainId } = useChain();
  const deployment = addressesFor(chainId);
  const activity = useActivity(assetId);

  return (
    <section className="bg-paper border-mist space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-ink text-lg">Transaction history</h2>
        <span className="text-ash text-[11px]">swaps &amp; primary buys</span>
      </div>

      <DataPanel query={activity} loadingLabel="Loading activity">
        {(items) => {
          const rows = toSwapRows(items, {
            tokenAddress: deployment.token,
            stableAddress: deployment.mockUSD,
            symbol,
          });

          if (rows.length === 0) {
            return <p className="text-ash text-xs">No swaps or purchases yet on this network.</p>;
          }

          return (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ash">
                  <tr>
                    <th scope="col" className="py-1 pr-3">Time</th>
                    <th scope="col" className="py-1 pr-3">Side</th>
                    <th scope="col" className="py-1 pr-3">Amount</th>
                    <th scope="col" className="py-1 pr-3">Received</th>
                    <th scope="col" className="py-1 pr-3">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const url = explorerTxUrl(chainId, row.txHash);
                    return (
                      <tr key={row.id} className="border-mist border-t">
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {formatRelative(row.timestamp)}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={
                              row.kind === "Buy" ? "text-provenance-live" : "text-provenance-mock"
                            }
                          >
                            {row.kind}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono">
                          {formatAmount(row.amountIn, 4)} {row.symbolIn}
                        </td>
                        <td className="py-1.5 pr-3 font-mono">
                          {formatAmount(row.amountOut, 4)} {row.symbolOut}
                          {row.partial && (
                            <span className="text-provenance-mock ml-1">partial</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {url === null ? (
                            <span className="text-ash font-mono">{shortAddress(row.txHash)}</span>
                          ) : (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cerulean-deep inline-flex items-center gap-1 font-mono underline"
                              title="View on the block explorer"
                            >
                              {shortAddress(row.txHash)}
                              <ExternalLink size={11} aria-hidden="true" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </DataPanel>
    </section>
  );
}
